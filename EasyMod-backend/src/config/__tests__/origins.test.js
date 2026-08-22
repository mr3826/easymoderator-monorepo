'use strict';

const { getOrigins, joinOrigin, normalizeOrigin } = require('../origins');

describe('canonical origins', () => {
    test('uses the production domain split by default', () => {
        expect(getOrigins({ NODE_ENV: 'production' })).toEqual({
            marketing: 'https://easymod.tech',
            app: 'https://app.easymod.tech',
            growth: 'https://growth.easymod.tech',
            api: 'https://api.easymod.tech',
            publicAssets: 'https://api.easymod.tech',
        });
    });

    test('supports aliases while keeping asset and API origins explicit', () => {
        expect(getOrigins({
            NODE_ENV: 'production',
            FRONTEND_URL: 'https://merchant.example.com',
            GROWTH_FRONTEND_URL: 'https://growth.example.com',
            BASE_URL: 'https://backend.example.com',
            PUBLIC_BASE_URL: 'https://media.example.com',
        })).toMatchObject({
            app: 'https://merchant.example.com',
            growth: 'https://growth.example.com',
            api: 'https://backend.example.com',
            publicAssets: 'https://media.example.com',
        });
    });

    test('normalizes and joins origins without carrying query or path state', () => {
        expect(normalizeOrigin('https://api.easymod.tech/')).toBe('https://api.easymod.tech');
        expect(joinOrigin('https://app.easymod.tech', '/signin')).toBe('https://app.easymod.tech/signin');
        expect(() => normalizeOrigin('https://api.easymod.tech?unsafe=1')).toThrow(/Invalid origin/);
    });
});
