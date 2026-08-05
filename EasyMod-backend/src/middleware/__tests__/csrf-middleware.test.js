'use strict';

const { isTrustedAuthOrigin } = require('../csrf-middleware');

describe('authentication origin binding', () => {
    const appOrigin = 'https://app.easymod.tech';

    test('accepts the exact merchant app origin in production', () => {
        expect(isTrustedAuthOrigin(appOrigin, 'production', appOrigin)).toBe(true);
    });

    test.each([
        undefined,
        'https://easymod.tech',
        'https://evil.easymod.tech',
        'https://app.easymod.tech.evil.example',
    ])('rejects an untrusted or missing production origin: %s', (origin) => {
        expect(isTrustedAuthOrigin(origin, 'production', appOrigin)).toBe(false);
    });

    test('does not constrain local and test environments', () => {
        expect(isTrustedAuthOrigin(undefined, 'test', appOrigin)).toBe(true);
        expect(isTrustedAuthOrigin('http://localhost:5173', 'development', appOrigin)).toBe(true);
    });
});
