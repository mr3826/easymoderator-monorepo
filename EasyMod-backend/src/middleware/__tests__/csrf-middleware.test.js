'use strict';

const { isTrustedAuthOrigin } = require('../csrf-middleware');

describe('authentication origin binding', () => {
    const appOrigin = 'https://app.easymod.tech';
    const growthOrigin = 'https://growth.easymod.tech';

    test('accepts the exact merchant app origin in production', () => {
        expect(isTrustedAuthOrigin(appOrigin, 'production', appOrigin)).toBe(true);
    });

    test.each([
        undefined,
        'https://easymod.tech',
        'https://evil.easymod.tech',
        'https://app.easymod.tech.evil.example',
    ])('rejects an untrusted or missing production origin: %s', (origin) => {
        expect(isTrustedAuthOrigin(origin, 'production', appOrigin, growthOrigin)).toBe(false);
    });

    test('accepts the exact Growth OS origin in production', () => {
        expect(isTrustedAuthOrigin(growthOrigin, 'production', appOrigin, growthOrigin)).toBe(true);
    });

    test('does not accept a sibling or lookalike Growth origin', () => {
        expect(isTrustedAuthOrigin('https://growth.easymod.tech.evil.example', 'production', appOrigin, growthOrigin)).toBe(false);
    });

    test('does not constrain local and test environments', () => {
        expect(isTrustedAuthOrigin(undefined, 'test', appOrigin)).toBe(true);
        expect(isTrustedAuthOrigin('http://localhost:5173', 'development', appOrigin)).toBe(true);
    });
});
