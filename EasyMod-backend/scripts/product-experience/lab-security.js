'use strict';

const crypto = require('node:crypto');

const MAX_BODY_BYTES = 64 * 1024;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const parseLoopbackAuthority = (authority, port) => {
    if (typeof authority !== 'string' || authority.length > 255) return false;
    try {
        const parsed = new URL(`http://${authority}`);
        return parsed.hostname === '127.0.0.1'
            && parsed.port === String(port)
            && !parsed.username
            && !parsed.password
            && parsed.pathname === '/'
            && !parsed.search
            && !parsed.hash;
    } catch (_) {
        return false;
    }
};

const constantTimeEqual = (provided, expected) => {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    const providedBytes = Buffer.from(provided, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return providedBytes.length === expectedBytes.length && crypto.timingSafeEqual(providedBytes, expectedBytes);
};

const isTrustedLabRequest = (request, port, token) => {
    if (!request || !LOOPBACK_ADDRESSES.has(request.remoteAddress)) return false;
    if (!parseLoopbackAuthority(request.host, port)) return false;
    const method = String(request.method || '').toUpperCase();
    if (!['GET', 'HEAD', 'POST'].includes(method)) return false;
    const originPresent = request.origin !== undefined && request.origin !== null && request.origin !== '';
    if (originPresent && !parseLoopbackAuthority(String(request.origin).replace(/^http:\/\//i, ''), port)) return false;
    if (method === 'GET' || method === 'HEAD') return true;
    if (!originPresent) return false;
    return constantTimeEqual(request.headers?.['x-lab-token'], token);
};

module.exports = { MAX_BODY_BYTES, isTrustedLabRequest };
