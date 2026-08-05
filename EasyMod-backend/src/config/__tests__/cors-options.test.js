'use strict';

const { buildCorsOptions } = require('../cors-options');

const config = {
    corsOrigins: ['https://app.easymod.tech'],
    origins: {
        app: 'https://app.easymod.tech',
        marketing: 'https://easymod.tech',
    },
};

function checkOrigin(options, origin) {
    return new Promise((resolve) => options.origin(origin, (error, allowed) => resolve({ error, allowed })));
}

describe('domain-split CORS options', () => {
    test('allows the app with credentials on protected routes', async () => {
        const options = buildCorsOptions({ path: '/api/orders' }, config);
        expect(options.credentials).toBe(true);
        await expect(checkOrigin(options, 'https://app.easymod.tech')).resolves.toMatchObject({ allowed: true });
    });

    test('allows marketing without credentials only on explicit public routes', async () => {
        const publicOptions = buildCorsOptions({ path: '/api/public/live-stats' }, config);
        expect(publicOptions.credentials).toBe(false);
        await expect(checkOrigin(publicOptions, 'https://easymod.tech')).resolves.toMatchObject({ allowed: true });

        const protectedOptions = buildCorsOptions({ path: '/api/orders' }, config);
        const result = await checkOrigin(protectedOptions, 'https://easymod.tech');
        expect(result.error).toBeInstanceOf(Error);
    });

    test('rejects hostile origins on both public and protected routes', async () => {
        for (const path of ['/api/partner/apply', '/api/orders']) {
            const result = await checkOrigin(buildCorsOptions({ path }, config), 'https://attacker.example');
            expect(result.error).toBeInstanceOf(Error);
        }
    });
});
