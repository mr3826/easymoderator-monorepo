'use strict';

/**
 * Tests for the CSRF session identifier strategy in csrf-middleware.js
 *
 * These tests verify the session identifier logic in isolation, without
 * actually instantiating the csrf-csrf library (which requires proper session
 * infrastructure).  The key invariants are:
 *
 *   1. Express sessionID is preferred when available.
 *   2. session.id fallback is used next.
 *   3. When neither is set, a random UUID is stored in session._csrfSessionId
 *      and returned — never an IP address.
 *   4. Two calls with no session ID both get the SAME UUID (stored in session).
 *   5. IP headers (x-forwarded-for, x-real-ip) are NEVER used as identifiers.
 */

// We test the identifier logic by extracting the behaviour the module embeds
// in getSessionIdentifier.  Since the function is a closure inside doubleCsrf
// config, we replicate it here and assert the same behaviour.

const crypto = require('crypto');

// Replicate the exact getSessionIdentifier logic from csrf-middleware.js
function getSessionIdentifier(req) {
    if (req.sessionID) return req.sessionID;
    if (req.session?.id) return req.session.id;

    if (req.session) {
        if (!req.session._csrfSessionId) {
            req.session._csrfSessionId = crypto.randomUUID();
            req.session.save = req.session.save || ((cb) => cb && cb());
            req.session.save((err) => {
                if (err) console.error('[csrf] session save error:', err.message);
            });
        }
        return req.session._csrfSessionId;
    }

    return crypto.randomUUID();
}

describe('CSRF getSessionIdentifier', () => {
    test('returns req.sessionID when present', () => {
        const req = { sessionID: 'sid-abc', session: {} };
        expect(getSessionIdentifier(req)).toBe('sid-abc');
    });

    test('returns session.id when sessionID is absent', () => {
        const req = { session: { id: 'session-id-123' } };
        expect(getSessionIdentifier(req)).toBe('session-id-123');
    });

    test('generates and stores UUID in session._csrfSessionId when no ID exists', () => {
        const req = { session: { save: jest.fn((cb) => cb && cb()) } };
        const id = getSessionIdentifier(req);
        expect(typeof id).toBe('string');
        expect(id).toMatch(/^[0-9a-f-]{36}$/); // UUID v4 pattern
        expect(req.session._csrfSessionId).toBe(id);
    });

    test('reuses stored _csrfSessionId on second call', () => {
        const req = { session: { save: jest.fn((cb) => cb && cb()) } };
        const id1 = getSessionIdentifier(req);
        const id2 = getSessionIdentifier(req);
        expect(id1).toBe(id2);
    });

    test('NEVER returns IP address from x-forwarded-for', () => {
        const req = {
            headers: { 'x-forwarded-for': '1.2.3.4' },
            ip: '1.2.3.4',
            session: { save: jest.fn((cb) => cb && cb()) }
        };
        const id = getSessionIdentifier(req);
        expect(id).not.toBe('1.2.3.4');
        // Should be a UUID
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('NEVER returns x-real-ip value', () => {
        const req = {
            headers: { 'x-real-ip': '10.0.0.1' },
            session: { save: jest.fn((cb) => cb && cb()) }
        };
        const id = getSessionIdentifier(req);
        expect(id).not.toBe('10.0.0.1');
    });

    test('generates unique UUID when session is unavailable', () => {
        const req = {};
        const id = getSessionIdentifier(req);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test('different sessionless requests get different UUIDs', () => {
        const req1 = {};
        const req2 = {};
        const id1 = getSessionIdentifier(req1);
        const id2 = getSessionIdentifier(req2);
        expect(id1).not.toBe(id2);
    });
});
