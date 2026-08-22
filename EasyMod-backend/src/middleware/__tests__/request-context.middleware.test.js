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
});
