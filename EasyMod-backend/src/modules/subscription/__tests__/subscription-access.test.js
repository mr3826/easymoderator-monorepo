/**
 * subscription.access — AI-gate predicate tests (pure, no DB).
 */

const { isAiActive, isTrialing } = require('../subscription.access');

describe('subscription.access · isAiActive', () => {
    it('allows AI for active and trialing shops', () => {
        expect(isAiActive({ status: 'active' })).toBe(true);
        expect(isAiActive({ status: 'trialing' })).toBe(true);
    });

    it('blocks AI for explicitly inactive billing states', () => {
        expect(isAiActive({ status: 'trial_expired' })).toBe(false);
        expect(isAiActive({ status: 'suspended' })).toBe(false);
        expect(isAiActive({ status: 'cancelled' })).toBe(false);
        expect(isAiActive({ status: 'inactive' })).toBe(false);
    });

    it('fails open for a missing subscription or unknown status', () => {
        expect(isAiActive(null)).toBe(true);
        expect(isAiActive(undefined)).toBe(true);
        expect(isAiActive({})).toBe(true);
        expect(isAiActive({ status: 'something_new' })).toBe(true);
    });

    it('is case-insensitive on status', () => {
        expect(isAiActive({ status: 'SUSPENDED' })).toBe(false);
        expect(isAiActive({ status: 'Trialing' })).toBe(true);
    });
});

describe('subscription.access · isTrialing', () => {
    it('is true only for trialing status', () => {
        expect(isTrialing({ status: 'trialing' })).toBe(true);
        expect(isTrialing({ status: 'active' })).toBe(false);
        expect(isTrialing(null)).toBe(false);
    });
});
