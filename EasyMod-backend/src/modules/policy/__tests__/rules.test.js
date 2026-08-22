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
        eval: jest.fn(),
        zrem: jest.fn(),
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
    test('defaults to POST_PURCHASE_UPDATE when outside window and no caller tag', async () => {
        const r = await rule.evaluate({}, { customer: { id: 'c1' }, platform: 'facebook' });
        expect(r.allow).toBe(true);
        expect(r.augment.within_window).toBe(false);
        expect(r.augment.message_tag).toBe('POST_PURCHASE_UPDATE');
    });
    test('honours a valid caller-provided messageTag outside window', async () => {
        const r = await rule.evaluate(
            { policy: { messageTag: 'ACCOUNT_UPDATE' } },
            { customer: { id: 'c1' }, platform: 'facebook' },
        );
        expect(r.allow).toBe(true);
        expect(r.augment.message_tag).toBe('ACCOUNT_UPDATE');
        expect(r.augment.within_window).toBe(false);
    });
    test('falls back to default tag when caller messageTag is not a real Meta tag', async () => {
        const r = await rule.evaluate(
            { policy: { messageTag: 'NOT_A_REAL_TAG' } },
            { customer: { id: 'c1' }, platform: 'facebook' },
        );
        expect(r.augment.message_tag).toBe('POST_PURCHASE_UPDATE');
    });
    test('does not set message_tag when within window', async () => {
        consentService.getLastInboundAt.mockReturnValue(new Date(Date.now() - 2 * 3600 * 1000));
        const r = await rule.evaluate({}, { customer: { id: 'c1' }, platform: 'facebook' });
        expect(r.augment.within_window).toBe(true);
        expect(r.augment.message_tag).toBeUndefined();
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
    test('allows outside window with a valid Meta message tag', async () => {
        const r = await rule.evaluate({}, {
            runningAugment: { within_window: false, message_tag: 'POST_PURCHASE_UPDATE' },
        });
        expect(r.allow).toBe(true);
        expect(r.reason).toBe('OUTSIDE_WINDOW_TAGGED');
    });
    test('denies with un-approved tag', async () => {
        const r = await rule.evaluate({}, {
            runningAugment: { within_window: false, message_tag: 'NOT_A_REAL_TAG' },
        });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('OUTSIDE_24H_TEMPLATES_DISABLED');
    });
    test('blocks a human-agent reply outside the window even with a valid tag', async () => {
        const r = await rule.evaluate({ senderRole: 'agent' }, {
            runningAugment: { within_window: false, message_tag: 'POST_PURCHASE_UPDATE' },
        });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('HUMAN_AGENT_OUTSIDE_WINDOW_BLOCKED');
    });
    test('allows a human-agent reply within the window', async () => {
        const r = await rule.evaluate({ senderRole: 'agent' }, {
            runningAugment: { within_window: true },
        });
        expect(r.allow).toBe(true);
        expect(r.reason).toBe('WITHIN_WINDOW');
    });
    test('AI/system sends outside the window are unaffected — still tagged POST_PURCHASE_UPDATE', async () => {
        const r = await rule.evaluate({ senderRole: 'ai' }, {
            runningAugment: { within_window: false, message_tag: 'POST_PURCHASE_UPDATE' },
        });
        expect(r.allow).toBe(true);
        expect(r.reason).toBe('OUTSIDE_WINDOW_TAGGED');
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
    test('fails closed on Redis error', async () => {
        cacheRedis.zcard.mockRejectedValue(new Error('redis down'));
        const r = await rule.evaluate({}, { channel: { meta_asset_id: 'PAGE_1' } });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('RATE_LIMIT_UNAVAILABLE');
    });
});

describe('rateLimit.rule — reserveSendSlot / releaseSendSlot (atomic reservation)', () => {
    const rule = require('src/modules/policy/rules/rateLimit.rule');

    // A minimal in-memory ZSET the mocked eval/zrem/zrange operate on. The
    // eval mock yields once (simulating a real network round trip) and then
    // runs prune+count+conditional-add synchronously in one stretch — the
    // same shape a real Redis Lua script has (latency before execution,
    // uninterruptible once it starts). That's what makes a concurrent
    // Promise.all against this mock a real test of the calling code: it can
    // only stay under the limit if reserveSendSlot issues one atomic call
    // per attempt rather than a separate check-then-write pair.
    let store;
    beforeEach(() => {
        store = new Map();
        cacheRedis.eval.mockImplementation(async (_script, _numKeys, key, now, windowMs, limit, member) => {
            await Promise.resolve();
            if (!store.has(key)) store.set(key, new Map());
            const zset = store.get(key);
            for (const [m, score] of zset) {
                if (score < now - windowMs) zset.delete(m);
            }
            if (zset.size < limit) {
                zset.set(member, now);
                return 1;
            }
            return 0;
        });
        cacheRedis.zrem.mockImplementation(async (key, member) => {
            store.get(key)?.delete(member);
            return 1;
        });
        cacheRedis.zrange.mockImplementation(async (key) => {
            const zset = store.get(key);
            if (!zset || zset.size === 0) return [];
            const [member, score] = [...zset.entries()][0];
            return [member, String(score)];
        });
    });

    test('single request is allowed and reserves a slot', async () => {
        const r = await rule.reserveSendSlot('PAGE_1');
        expect(r.allowed).toBe(true);
        expect(r.member).toBeTruthy();
    });

    test('no-op allow (no reservation) when pageId is missing, matching evaluate()\'s NO_CHANNEL passthrough', async () => {
        const r = await rule.reserveSendSlot(undefined);
        expect(r.allowed).toBe(true);
        expect(r.member).toBeUndefined();
        expect(cacheRedis.eval).not.toHaveBeenCalled();
    });

    test('boundary: exactly META_SEND_LIMIT reservations succeed, the next is denied', async () => {
        for (let i = 0; i < rule.META_SEND_LIMIT; i++) {
            const r = await rule.reserveSendSlot('PAGE_2');
            expect(r.allowed).toBe(true);
        }
        const denied = await rule.reserveSendSlot('PAGE_2');
        expect(denied.allowed).toBe(false);
        expect(denied.retryAfterMs).toBeGreaterThan(0);
    });

    test('concurrent requests at the boundary never exceed the limit', async () => {
        const attempts = rule.META_SEND_LIMIT + 50;
        const results = await Promise.all(
            Array.from({ length: attempts }, () => rule.reserveSendSlot('PAGE_3')),
        );
        const allowedCount = results.filter((r) => r.allowed).length;
        expect(allowedCount).toBe(rule.META_SEND_LIMIT);
    });

    test('provider failure after reservation releases the slot for a later request', async () => {
        const reservations = [];
        for (let i = 0; i < rule.META_SEND_LIMIT; i++) {
            reservations.push(await rule.reserveSendSlot('PAGE_4'));
        }
        expect(reservations.every((r) => r.allowed)).toBe(true);
        const denied = await rule.reserveSendSlot('PAGE_4');
        expect(denied.allowed).toBe(false);

        // Simulate the provider's send failing for one reservation and releasing it.
        await rule.releaseSendSlot('PAGE_4', reservations[0].member);
        const afterRelease = await rule.reserveSendSlot('PAGE_4');
        expect(afterRelease.allowed).toBe(true);
    });

    test('tenant isolation: two pageIds never share a quota window', async () => {
        for (let i = 0; i < rule.META_SEND_LIMIT; i++) {
            const r = await rule.reserveSendSlot('PAGE_TENANT_A');
            expect(r.allowed).toBe(true);
        }
        const deniedA = await rule.reserveSendSlot('PAGE_TENANT_A');
        expect(deniedA.allowed).toBe(false);

        const stillAllowedB = await rule.reserveSendSlot('PAGE_TENANT_B');
        expect(stillAllowedB.allowed).toBe(true);
    });

    test('fails closed with a retry hint when Redis eval throws', async () => {
        cacheRedis.eval.mockRejectedValueOnce(new Error('redis down'));
        const r = await rule.reserveSendSlot('PAGE_5');
        expect(r.allowed).toBe(false);
        expect(r.retryAfterMs).toBeGreaterThan(0);
    });

    test('releaseSendSlot is a no-op when given no member (nothing to release)', async () => {
        await expect(rule.releaseSendSlot('PAGE_6', undefined)).resolves.toBeUndefined();
        expect(cacheRedis.zrem).not.toHaveBeenCalled();
    });
});

describe('draftMode.rule', () => {
    const rule = require('src/modules/policy/rules/draftMode.rule');
    test.each(['DRAFT', 'AI_SUGGEST_ONLY', 'HUMAN_ACTIVE', 'MANUAL'])('denies when automation_mode=%s', async (mode) => {
        const r = await rule.evaluate({}, { settings: { automation_mode: mode } });
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('DRAFT_MODE');
    });
    test('allows when AI_ACTIVE', async () => {
        const r = await rule.evaluate({}, { settings: { automation_mode: 'AI_ACTIVE' } });
        expect(r.allow).toBe(true);
    });
    test('holds when no settings (fail-safe default is DRAFT, not AI_ACTIVE)', async () => {
        const r = await rule.evaluate({}, {});
        expect(r.allow).toBe(false);
        expect(r.reason).toBe('DRAFT_MODE');
    });

    // Regression guard: AI_ACTIVE is the ONLY mode that may deliver to a
    // customer. HUMAN_ACTIVE shipped absent from the deny set and therefore
    // auto-sent. Enumerating the persisted enum here means a mode added to the
    // column but forgotten in NON_DELIVERING_MODES fails this test instead of
    // silently auto-sending in production.
    const PERSISTED_AUTOMATION_MODES = ['AI_ACTIVE', 'AI_SUGGEST_ONLY', 'HUMAN_ACTIVE', 'MANUAL', 'DRAFT'];
    test('AI_ACTIVE is the only persisted mode that delivers', async () => {
        const delivering = [];
        for (const mode of PERSISTED_AUTOMATION_MODES) {
            // eslint-disable-next-line no-await-in-loop
            const r = await rule.evaluate({}, { settings: { automation_mode: mode } });
            if (r.allow) delivering.push(mode);
        }
        expect(delivering).toEqual(['AI_ACTIVE']);
    });
});
