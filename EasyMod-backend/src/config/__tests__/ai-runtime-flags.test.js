'use strict';

process.env.NODE_ENV = 'test';

const {
    isRuntimeFlagEnabled,
    isDomainAgentActionEnabled,
    MUTATING_ACTION_FLAGS,
} = require('../ai-runtime-flags');
const { MUTATING_ACTION_TYPES } = require('../../modules/ai/contracts/action.contract');

const withEnv = (vars, fn) => {
    const saved = {};
    for (const key of Object.keys(vars)) {
        saved[key] = process.env[key];
        if (vars[key] === undefined) delete process.env[key];
        else process.env[key] = vars[key];
    }
    try {
        return fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
};

describe('AI runtime flags', () => {
    test('every mutating action type has an explicit kill-switch flag', () => {
        for (const actionType of MUTATING_ACTION_TYPES) {
            expect(MUTATING_ACTION_FLAGS[actionType]).toEqual(expect.any(String));
        }
    });

    test('production defaults deny every mutating action while the parent is on', () => {
        withEnv({ NODE_ENV: 'production', DOMAIN_AGENT_RUNTIME_ENABLED: 'true' }, () => {
            for (const actionType of MUTATING_ACTION_TYPES) {
                expect(isDomainAgentActionEnabled(actionType)).toBe(false);
            }
            expect(isRuntimeFlagEnabled('AI_ANYTHING')).toBe(false);
        });
    });

    test('unknown action types fail closed', () => {
        withEnv({
            NODE_ENV: 'production',
            DOMAIN_AGENT_RUNTIME_ENABLED: 'true',
            AI_ORDER_MUTATIONS_ENABLED: 'true',
        }, () => {
            expect(isDomainAgentActionEnabled('SOMETHING_NEW')).toBe(false);
            expect(isDomainAgentActionEnabled(undefined)).toBe(false);
        });
    });

    test('mapped actions open only through their own flag', () => {
        withEnv({
            DOMAIN_AGENT_RUNTIME_ENABLED: 'true',
            AI_COURIER_BOOKING_ENABLED: 'false',
        }, () => {
            expect(isDomainAgentActionEnabled('BOOK_COURIER')).toBe(false);
            expect(isDomainAgentActionEnabled('CREATE_ORDER')).toBe(true);
        });
    });

    test('read types ride the parent flag only', () => {
        withEnv({ DOMAIN_AGENT_RUNTIME_ENABLED: 'true' }, () => {
            expect(isDomainAgentActionEnabled('READ_PRODUCT')).toBe(true);
        });
        withEnv({ DOMAIN_AGENT_RUNTIME_ENABLED: 'false' }, () => {
            expect(isDomainAgentActionEnabled('READ_PRODUCT')).toBe(false);
        });
    });
});
