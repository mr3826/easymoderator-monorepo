/**
 * rules.test.js
 *
 * Focused unit tests for each individual policy rule. Each rule is a pure
 * function (modulo consentService for the two consent rules and Redis for
 * rateLimit), so they're easy to test in isolation.
 */

'use strict';

process.env.NODE_ENV = 'test';

jest.mock('src/modules/consent/consent.service', () => ({
    hasConsent: jest.fn(),
    getLastInboundAt: jest.fn(),
}));

jest.mock('src/config/redis', () => ({
    cacheRedis: {
        zremrangebyscore: jest.fn().mockResolvedValue(0),
        zcard: jest.fn().mockResolvedValue(0),
        zrange: jest.fn().mockResolvedValue([]),
    },
}));

const consentService = require('src/modules/consent/consent.service');
const { cacheRedis } = require('src/config/redis');

beforeEach(() => jest.clearAllMocks());

describe('consentRequired.rule', () => {
    const rule = require('src/modules/policy/rules/consentRequired.rule');
    test('denies when consentService.hasConsent returns false', async () => {
        consentService.hasConsent.mockReturnValue(false);
        const r = await rule.evaluate({}, { customer: { id: 'c1' }, platform: 'facebook' });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('NO_CONSENT');
    });
    test('allows when no customer context', async () => {
        const r = await rule.evaluate({}, { platform: 'facebook' });
        expect(r.allow).toBe(true);
    });
    test('allows when consent present', async () => {
        consentService.hasConsent.mockReturnValue(true);
        const r = await rule.evaluate({}, { customer: { id: 'c1' }, platform: 'facebook' });
        expect(r.allow).toBe(true);
    });
});

describe('messengerOptedOut.rule', () => {
    const rule = require('src/modules/policy/rules/messengerOptedOut.rule');
    test('denies when per-channel opted_out_at is set (Phase 5)', async () => {
        const customer = { messaging_consent: { facebook: { opted_out_at: '2026-05-19T10:00:00Z' } } };
        const r = await rule.evaluate({ platform: 'facebook' }, { customer, platform: 'facebook' });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('OPTED_OUT');
    });
    test('allows when per-channel opted_out_at is null', async () => {
        const customer = { messaging_consent: { facebook: { opted_out_at: null, opted_in: true } } };
        const r = await rule.evaluate({ platform: 'facebook' }, { customer, platform: 'facebook' });
        expect(r.allow).toBe(true);
    });
    test('allows when no customer context', async () => {
        const r = await rule.evaluate({}, { customer: null, platform: 'facebook' });
        expect(r.allow).toBe(true);
    });
});

describe('twentyFourHourWindow.rule', () => {
    const rule = require('src/modules/policy/rules/twentyFourHourWindow.rule');
    test('ignores caller-provided legacy messageTag for BD launch', async () => {
        const r = await rule.evaluate(
            { policy: { messageTag: 'POST_PURCHASE_UPDATE' } },
            { customer: { id: 'c1' }, platform: 'facebook' },
        );
        expect(r.allow).toBe(true);
        expect(r.augment.message_tag).toBeUndefined();
        expect(r.augment.within_window).toBe(false);
    });
    test('within_window=true when last inbound was <24h ago', async () => {
        consentService.getLastInboundAt.mockReturnValue(new Date(Date.now() - 2 * 3600 * 1000));
        const r = await rule.evaluate({}, { customer: { id: 'c1' }, platform: 'facebook' });
        expect(r.augment.within_window).toBe(true);
    });
    test('within_window=false when last inbound was >24h ago', async () => {
        consentService.getLastInboundAt.mockReturnValue(new Date(Date.now() - 36 * 3600 * 1000));
        const r = await rule.evaluate({}, { customer: { id: 'c1' }, platform: 'facebook' });
        expect(r.augment.within_window).toBe(false);
    });
});

describe('templateRequired.rule', () => {
    const rule = require('src/modules/policy/rules/templateRequired.rule');
    test('allows when within window', async () => {
        const r = await rule.evaluate({}, { runningAugment: { within_window: true } });
        expect(r.allow).toBe(true);
    });
    test('denies when outside window and no tag', async () => {
        const r = await rule.evaluate({}, { runningAugment: { within_window: false } });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('OUTSIDE_24H_TEMPLATES_DISABLED');
    });
    test('denies when outside window with legacy tag', async () => {
        const r = await rule.evaluate({}, {
            runningAugment: { within_window: false, message_tag: 'POST_PURCHASE_UPDATE' },
        });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('OUTSIDE_24H_TEMPLATES_DISABLED');
    });
    test('denies with un-approved tag', async () => {
        const r = await rule.evaluate({}, {
            runningAugment: { within_window: false, message_tag: 'NOT_A_REAL_TAG' },
        });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('OUTSIDE_24H_TEMPLATES_DISABLED');
    });
});

describe('contentSanitizer.rule', () => {
    const rule = require('src/modules/policy/rules/contentSanitizer.rule');
    test('redacts a 16-digit credit card number', async () => {
        const r = await rule.evaluate({ text: 'card is 4111111111111111 thanks' }, {});
        expect(r.transform.text).toContain('[redacted-card]');
        expect(r.transform.text).not.toMatch(/4111111111111111/);
    });
    test('redacts BD 10-digit NID', async () => {
        const r = await rule.evaluate({ text: 'NID 1234567890 please' }, {});
        expect(r.transform.text).toContain('[redacted-nid]');
    });
    test('redacts "PIN: 1234"', async () => {
        const r = await rule.evaluate({ text: 'PIN: 1234' }, {});
        expect(r.transform.text).toContain('[redacted-pin]');
    });
    test('passes a clean message through unchanged', async () => {
        const r = await rule.evaluate({ text: 'hello world' }, {});
        expect(r.reason).toBe('CLEAN');
        expect(r.transform).toBeUndefined();
    });
    test('no-ops on missing text', async () => {
        const r = await rule.evaluate({}, {});
        expect(r.allow).toBe(true);
    });
});

describe('businessHours.rule', () => {
    const rule = require('src/modules/policy/rules/businessHours.rule');
    test('no-op when no hours config', async () => {
        const r = await rule.evaluate({}, { settings: {} });
        expect(r.allow).toBe(true);
        expect(r.reason).toBe('NO_HOURS_CONFIG');
    });
    test('denies (SUGGEST_ONLY) when AI_ACTIVE + outside hours', async () => {
        // Set up hours that don't include current time: 03:00–03:01
        const hours = {
            sun: { open: '03:00', close: '03:01' },
            mon: { open: '03:00', close: '03:01' },
            tue: { open: '03:00', close: '03:01' },
            wed: { open: '03:00', close: '03:01' },
            thu: { open: '03:00', close: '03:01' },
            fri: { open: '03:00', close: '03:01' },
            sat: { open: '03:00', close: '03:01' },
        };
        // Only run the assertion when "now" is not in 03:00–03:01 window —
        // skipped in the unlucky minute to keep the test deterministic.
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin === 3 * 60) return;
        const r = await rule.evaluate({}, {
            settings: { automation_mode: 'AI_ACTIVE', business_hours: hours },
        });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('SUGGEST_ONLY');
    });
});

describe('rateLimit.rule', () => {
    const rule = require('src/modules/policy/rules/rateLimit.rule');
    test('allows when no channel context', async () => {
        const r = await rule.evaluate({}, {});
        expect(r.allow).toBe(true);
        expect(r.reason).toBe('NO_CHANNEL');
    });
    test('allows when under limit', async () => {
        cacheRedis.zcard.mockResolvedValue(10);
        const r = await rule.evaluate({}, { channel: { meta_asset_id: 'PAGE_1' } });
        expect(r.allow).toBe(true);
    });
    test('denies + retryAfterMs when at limit', async () => {
        cacheRedis.zcard.mockResolvedValue(170);
        cacheRedis.zrange.mockResolvedValue([`m`, String(Date.now() - 60 * 60 * 1000 + 5000)]);
        const r = await rule.evaluate({}, { channel: { meta_asset_id: 'PAGE_1' } });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('RATE_LIMIT');
        expect(r.retryAfterMs).toBeGreaterThan(0);
    });
    test('falls open on Redis error', async () => {
        cacheRedis.zcard.mockRejectedValue(new Error('redis down'));
        const r = await rule.evaluate({}, { channel: { meta_asset_id: 'PAGE_1' } });
        expect(r.allow).toBe(true);
        expect(r.reason).toBe('REDIS_UNAVAILABLE');
    });
});

describe('draftMode.rule', () => {
    const rule = require('src/modules/policy/rules/draftMode.rule');
    test.each(['DRAFT', 'AI_SUGGEST_ONLY', 'MANUAL'])('denies when automation_mode=%s', async (mode) => {
        const r = await rule.evaluate({}, { settings: { automation_mode: mode } });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('DRAFT_MODE');
    });
    test('allows when AI_ACTIVE', async () => {
        const r = await rule.evaluate({}, { settings: { automation_mode: 'AI_ACTIVE' } });
        expect(r.allow).toBe(true);
    });
    test('allows when no settings (defaults to AI_ACTIVE)', async () => {
        const r = await rule.evaluate({}, {});
        expect(r.allow).toBe(true);
    });
});
