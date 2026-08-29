'use strict';

const {
    effectiveConversationLimit,
    isConversationQuotaExhausted
} = require('../subscription.access');

describe('conversation usage gate contract', () => {
    it.each([
        [{ conversations_limit: 100, conversations_used: 0 }, false],
        [{ conversations_limit: 100, conversations_used: 99 }, false],
        [{ conversations_limit: 100, conversations_used: 100 }, true],
        [{ conversations_limit: 100, conversations_used: 101 }, true],
        [{ conversations_limit: 100, topup_balance: 1, conversations_used: 100 }, false],
        [{ conversations_limit: -1, conversations_used: 100000 }, false],
        [null, false]
    ])('returns %s => exhausted=%s', (subscription, exhausted) => {
        expect(isConversationQuotaExhausted(subscription)).toBe(exhausted);
    });

    it('never turns a missing row or unlimited sentinel into a hard block', () => {
        expect(effectiveConversationLimit(null)).toBe(-1);
        expect(effectiveConversationLimit({ conversations_limit: -1, topup_balance: 999 })).toBe(-1);
    });
});
