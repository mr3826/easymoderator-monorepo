/**
 * policy.engine.test.js
 *
 * Pipeline mechanics: short-circuit on first deny, transform propagation
 * across rules, augment merging, persistence call, fail-closed on rule error.
 *
 * The 8 production rules are NOT exercised here — they have their own focused
 * tests. We mock policy.rules with a small synthetic pipeline so engine
 * behaviour is testable in isolation.
 */

'use strict';

process.env.NODE_ENV = 'test';

jest.mock('src/modules/policy/policy-decision.entity', () => ({
    create: jest.fn().mockResolvedValue({ id: 'decision-id-1' }),
}));

let mockRules = [];
jest.mock('src/modules/policy/policy.rules', () => mockRules, { virtual: false });

// Engine module reads `rules` at require time — reset module registry between
// tests so each test can install a fresh pipeline.
function loadEngineWithRules(rules) {
    jest.resetModules();
    jest.doMock('src/modules/policy/policy-decision.entity', () => ({
        create: jest.fn().mockResolvedValue({ id: 'decision-id-1' }),
    }));
    jest.doMock('src/modules/policy/policy.rules', () => rules);
    // eslint-disable-next-line global-require
    return {
        engine: require('src/modules/policy/policy.engine'),
        PolicyDecision: require('src/modules/policy/policy-decision.entity'),
    };
}

beforeEach(() => jest.clearAllMocks());

describe('PolicyEngine.evaluateOutbound', () => {
    test('allows when every rule allows; persists a row', async () => {
        const ruleA = { name: 'A', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        const ruleB = { name: 'B', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        const { engine, PolicyDecision } = loadEngineWithRules([ruleA, ruleB]);

        const decision = await engine.evaluateOutbound(
            { text: 'hi', platform: 'facebook' },
            { shopId: 's1', platform: 'facebook' },
        );

        expect(decision.allow).toBe(true);
        expect(decision.reason).toBe('OK');
        expect(decision.ruleResults).toHaveLength(2);
        expect(PolicyDecision.create).toHaveBeenCalledTimes(1);
        expect(PolicyDecision.create).toHaveBeenCalledWith(
            expect.objectContaining({
                shop_id: 's1', platform: 'facebook', allow: true, reason: 'OK',
            }),
        );
    });

    test('short-circuits on first deny — downstream rules NOT called', async () => {
        const ruleA = { name: 'A', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        const ruleB = { name: 'B', evaluate: jest.fn().mockResolvedValue({ allow: false, reason: 'OPTED_OUT' }) };
        const ruleC = { name: 'C', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        const { engine } = loadEngineWithRules([ruleA, ruleB, ruleC]);

        const decision = await engine.evaluateOutbound({ text: 'hi' }, { shopId: 's1', platform: 'facebook' });

        expect(decision.allow).toBe(false);
        expect(decision.reason).toBe('OPTED_OUT');
        expect(ruleA.evaluate).toHaveBeenCalled();
        expect(ruleB.evaluate).toHaveBeenCalled();
        expect(ruleC.evaluate).not.toHaveBeenCalled();
        expect(decision.ruleResults.map(r => r.name)).toEqual(['A', 'B']);
    });

    test('propagates transform through subsequent rules', async () => {
        const sanitize = {
            name: 'sanitize',
            evaluate: jest.fn().mockResolvedValue({
                allow: true, reason: 'SANITIZED',
                transform: { text: 'hi [redacted]' },
            }),
        };
        const observer = {
            name: 'observer',
            evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }),
        };
        const { engine, PolicyDecision } = loadEngineWithRules([sanitize, observer]);

        const decision = await engine.evaluateOutbound(
            { text: 'hi 4111111111111111' },
            { shopId: 's1', platform: 'facebook' },
        );

        expect(observer.evaluate).toHaveBeenCalledWith(
            expect.objectContaining({ text: 'hi [redacted]' }),
            expect.anything(),
        );
        expect(decision.transform.text).toBe('hi [redacted]');
        expect(decision.transformApplied).toBe(true);
        expect(PolicyDecision.create).toHaveBeenCalledWith(
            expect.objectContaining({ transform_applied: true }),
        );
    });

    test('merges augment from multiple rules; surfaces retryAfterMs', async () => {
        const r1 = {
            name: 'window',
            evaluate: jest.fn().mockResolvedValue({
                allow: true, reason: 'OUTSIDE_WINDOW',
                augment: { within_window: false },
            }),
        };
        const r2 = {
            name: 'rateLimit',
            evaluate: jest.fn().mockResolvedValue({
                allow: false, reason: 'RATE_LIMIT', retryAfterMs: 12345,
                augment: { rate_count: 170 },
            }),
        };
        const { engine } = loadEngineWithRules([r1, r2]);

        const decision = await engine.evaluateOutbound({ text: 'hi' }, { shopId: 's', platform: 'facebook' });

        expect(decision.allow).toBe(false);
        expect(decision.reason).toBe('RATE_LIMIT');
        expect(decision.retryAfterMs).toBe(12345);
        expect(decision.augment).toEqual({ within_window: false, rate_count: 170 });
    });

    test('fail-closed when a rule throws', async () => {
        const broken = { name: 'broken', evaluate: jest.fn().mockRejectedValue(new Error('boom')) };
        const next = { name: 'next', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        const { engine } = loadEngineWithRules([broken, next]);

        const decision = await engine.evaluateOutbound({ text: 'x' }, { shopId: 's', platform: 'facebook' });

        expect(decision.allow).toBe(false);
        expect(decision.reason).toBe('RULE_ERROR');
        expect(next.evaluate).not.toHaveBeenCalled();
    });

    test('evaluatePreFlight skips persistence', async () => {
        const allowRule = { name: 'A', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        const { engine, PolicyDecision } = loadEngineWithRules([allowRule]);

        const decision = await engine.evaluatePreFlight({ text: 'x' }, { shopId: 's', platform: 'facebook' });

        expect(decision.allow).toBe(true);
        expect(PolicyDecision.create).not.toHaveBeenCalled();
    });

    test('persistence failure does NOT block the send', async () => {
        const allowRule = { name: 'A', evaluate: jest.fn().mockResolvedValue({ allow: true, reason: 'OK' }) };
        jest.resetModules();
        jest.doMock('src/modules/policy/policy.rules', () => [allowRule]);
        jest.doMock('src/modules/policy/policy-decision.entity', () => ({
            create: jest.fn().mockRejectedValue(new Error('db down')),
        }));
        // eslint-disable-next-line global-require
        const engine = require('src/modules/policy/policy.engine');

        const decision = await engine.evaluateOutbound({ text: 'x' }, { shopId: 's', platform: 'facebook' });

        expect(decision.allow).toBe(true);
        expect(decision.decisionId).toBeUndefined();
    });
});
