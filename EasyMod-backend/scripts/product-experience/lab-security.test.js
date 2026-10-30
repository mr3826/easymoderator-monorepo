'use strict';

const { isTrustedLabRequest, MAX_BODY_BYTES } = require('./lab-security');

describe('loopback Test Lab request guard', () => {
    const port = 4278;
    const token = 'a'.repeat(64);
    const request = (overrides = {}) => ({
        remoteAddress: '127.0.0.1',
        host: `127.0.0.1:${port}`,
        origin: `http://127.0.0.1:${port}`,
        method: 'POST',
        headers: { 'x-lab-token': token },
        ...overrides,
    });

    test('accepts same-origin loopback reads and authenticated mutations only', () => {
        expect(isTrustedLabRequest(request(), port, token)).toBe(true);
        expect(isTrustedLabRequest(request({ method: 'GET', origin: undefined, headers: {} }), port, token)).toBe(true);
        expect(isTrustedLabRequest(request({ remoteAddress: '::ffff:127.0.0.1' }), port, token)).toBe(true);
    });

    test('rejects non-loopback clients, hostile host/origin headers and missing tokens', () => {
        expect(isTrustedLabRequest(request({ remoteAddress: '192.168.1.5' }), port, token)).toBe(false);
        expect(isTrustedLabRequest(request({ host: `127.0.0.1:${port}.evil.test` }), port, token)).toBe(false);
        expect(isTrustedLabRequest(request({ origin: 'https://127.0.0.1:4278' }), port, token)).toBe(false);
        expect(isTrustedLabRequest(request({ origin: `http://evil.test:${port}` }), port, token)).toBe(false);
        expect(isTrustedLabRequest(request({ headers: {} }), port, token)).toBe(false);
        expect(isTrustedLabRequest(request({ headers: { 'x-lab-token': 'wrong' } }), port, token)).toBe(false);
        expect(isTrustedLabRequest(request({ host: 'localhost:4278' }), port, token)).toBe(false);
    });

    test('sets a finite request body limit', () => {
        expect(MAX_BODY_BYTES).toBeGreaterThan(1024);
        expect(MAX_BODY_BYTES).toBeLessThanOrEqual(64 * 1024);
    });
});
