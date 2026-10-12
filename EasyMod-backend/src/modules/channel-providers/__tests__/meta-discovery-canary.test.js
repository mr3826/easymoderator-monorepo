'use strict';

const {
    MAX_WINDOW_MS,
    createCanaryAttempt,
    createDiagnostics,
    readCanaryConfig,
    resumeCanaryAttempt,
    sanitizeTasks,
    snapshotDiagnostics,
} = require('../meta-discovery-canary');

const NOW = Date.parse('2026-10-12T20:00:00.000Z');
const BASE_ENV = {
    META_DISCOVERY_CANARY_ENABLED: 'true',
    META_DISCOVERY_CANARY_SHOP_ID: 'shop-kutir',
    META_DISCOVERY_CANARY_PAGE_ID: '1362174360316889',
    META_DISCOVERY_CANARY_EXPIRES_AT: new Date(NOW + 30 * 60 * 1000).toISOString(),
};

describe('Meta discovery canary boundary', () => {
    test('is disabled by default and requires an exact shop and valid Page ID', () => {
        expect(readCanaryConfig({}, NOW).active).toBe(false);
        expect(createCanaryAttempt({
            authenticatedShopId: 'shop-other',
            stateShopId: 'shop-other',
            env: BASE_ENV,
            now: NOW,
        })).toBeNull();
    });

    test('accepts only a configured shop within the maximum one-hour window', () => {
        const attempt = createCanaryAttempt({
            authenticatedShopId: 'shop-kutir',
            stateShopId: 'shop-kutir',
            requestId: '11111111-1111-4111-8111-111111111111',
            env: BASE_ENV,
            now: NOW,
        });

        expect(attempt).toMatchObject({
            expectedPageId: '1362174360316889',
            initiateRequestId: '11111111-1111-4111-8111-111111111111',
            createdAt: '2026-10-12T20:00:00.000Z',
        });
        expect(attempt.correlationId).toMatch(/^[a-f0-9]{32}$/);
        expect(readCanaryConfig(BASE_ENV, NOW).remainingMs).toBeLessThanOrEqual(MAX_WINDOW_MS);
    });

    test('rejects expired, overlong, malformed, and mismatched callback attempts', () => {
        expect(readCanaryConfig({
            ...BASE_ENV,
            META_DISCOVERY_CANARY_EXPIRES_AT: new Date(NOW + MAX_WINDOW_MS + 1).toISOString(),
        }, NOW).active).toBe(false);
        expect(readCanaryConfig({
            ...BASE_ENV,
            META_DISCOVERY_CANARY_EXPIRES_AT: new Date(NOW - 1).toISOString(),
        }, NOW).active).toBe(false);
        expect(readCanaryConfig({ ...BASE_ENV, META_DISCOVERY_CANARY_PAGE_ID: 'page-name' }, NOW).active).toBe(false);

        const attempt = createCanaryAttempt({
            authenticatedShopId: 'shop-kutir',
            stateShopId: 'shop-kutir',
            env: BASE_ENV,
            now: NOW,
        });
        expect(resumeCanaryAttempt({
            authenticatedShopId: 'shop-other',
            stateShopId: 'shop-kutir',
            storedAttempt: attempt,
            env: BASE_ENV,
            now: NOW,
        })).toBeNull();
        expect(resumeCanaryAttempt({
            authenticatedShopId: 'shop-kutir',
            stateShopId: 'shop-kutir',
            storedAttempt: attempt,
            requestId: '22222222-2222-4222-8222-222222222222',
            env: BASE_ENV,
            now: NOW + 31 * 60 * 1000,
        })).toBeNull();
    });

    test('diagnostics contain no token fields and sanitize task names', () => {
        const diagnostics = createDiagnostics({
            correlationId: 'correlation-1',
            createdAt: '2026-10-12T20:00:00.000Z',
            expectedPageId: '1362174360316889',
            expiresAt: BASE_ENV.META_DISCOVERY_CANARY_EXPIRES_AT,
            initiateRequestId: null,
            callbackRequestId: '22222222-2222-4222-8222-222222222222',
        });
        expect(diagnostics).not.toHaveProperty('userToken');
        expect(sanitizeTasks([' messaging ', 'MANAGE', 'raw token value', 'x'.repeat(65)])).toEqual([
            'MESSAGING',
            'MANAGE',
        ]);
        expect(JSON.stringify(snapshotDiagnostics(diagnostics))).not.toContain('access_token');
        expect(JSON.stringify(snapshotDiagnostics(diagnostics))).toContain('correlation-1');
        expect(snapshotDiagnostics(diagnostics).retentionExpiresAt).toBe('2026-10-13T20:00:00.000Z');
    });
});
