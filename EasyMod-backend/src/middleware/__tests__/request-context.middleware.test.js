'use strict';

const mockLogger = {
    info: jest.fn(),
};

jest.mock('../../utils/structured-logger', () => ({
    createLogger: jest.fn(() => mockLogger),
}));

const {
    requestContextMiddleware,
    safeQueryForLog,
} = require('../request-context.middleware');

describe('request context logging', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('redacts prospect identity query values before structured logging', () => {
        expect(safeQueryForLog({
            q: 'Owner phone 01700000000',
            contactEmail: 'owner@example.com',
            pageUrl: 'https://facebook.com/example',
            sourceReference: 'partner:owner@example.com',
            metadata: { email: 'owner@example.com' },
            source: 'partner_form',
            pageSize: '20',
        })).toEqual({
            q: '[REDACTED]',
            contactEmail: '[REDACTED]',
            pageUrl: '[REDACTED]',
            sourceReference: '[REDACTED]',
            metadata: '[REDACTED]',
            source: 'partner_form',
            pageSize: '20',
        });
    });

    it('logs the sanitized query shape, not the raw request query', () => {
        const req = {
            headers: {},
            user: null,
            method: 'GET',
            path: '/api/internal/growth-os/prospects',
            query: { q: 'private phone 01700000000' },
            ip: '127.0.0.1',
        };
        const res = {
            set: jest.fn(),
            send: jest.fn(),
        };
        const next = jest.fn();

        requestContextMiddleware(req, res, next);

        expect(mockLogger.info).toHaveBeenCalledWith('Incoming request', expect.objectContaining({
            query: { q: '[REDACTED]' },
        }));
        expect(JSON.stringify(mockLogger.info.mock.calls)).not.toContain('01700000000');
        expect(next).toHaveBeenCalledTimes(1);
    });

    it('records latency and the mobile client identity on the response log', () => {
        const req = { headers: {}, user: null, method: 'GET', path: '/api/mobile/today', query: {}, ip: '127.0.0.1' };
        const res = { set: jest.fn(), send: jest.fn(), statusCode: 200 };
        requestContextMiddleware(req, res, jest.fn());

        // mobileClientContext runs after this middleware; the value is read at send time.
        req.mobileClient = `android/1.0.0 ${'x'.repeat(200)}`;
        res.send('{}');

        const [, meta] = mockLogger.info.mock.calls.find(([message]) => message === 'Response sent');
        expect(meta).toMatchObject({ statusCode: 200, method: 'GET', path: '/api/mobile/today' });
        expect(Number.isInteger(meta.durationMs)).toBe(true);
        expect(meta.durationMs).toBeGreaterThanOrEqual(0);
        expect(meta.client).toHaveLength(64);
        expect(meta.client.startsWith('android/1.0.0')).toBe(true);
    });

    it('logs a null client for web requests', () => {
        const req = { headers: {}, user: null, method: 'GET', path: '/api/dashboard', query: {}, ip: '127.0.0.1' };
        const res = { set: jest.fn(), send: jest.fn(), statusCode: 200 };
        requestContextMiddleware(req, res, jest.fn());
        res.send('{}');

        const [, meta] = mockLogger.info.mock.calls.find(([message]) => message === 'Response sent');
        expect(meta.client).toBeNull();
    });
});
