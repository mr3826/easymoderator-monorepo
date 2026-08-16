'use strict';

const {
    safeErrorType,
    sanitizeErrorSummary,
} = require('../reindex-qdrant');

describe('reindex diagnostics', () => {
    test('classifies bootstrap errors without exposing URL values', () => {
        const error = new TypeError('Failed to parse URL from "http://qdrant:6333/path?key=secret"');

        expect(safeErrorType(error)).toBe('TypeError');
        expect(sanitizeErrorSummary(error)).toBe('Failed to parse URL from [url]');
        expect(sanitizeErrorSummary(error)).not.toContain('qdrant:6333');
        expect(sanitizeErrorSummary(error)).not.toContain('secret');
    });

    test('redacts database URLs and API-key-like tokens', () => {
        const error = new Error('request failed for postgresql://user:pass@postgres:5432/db sk-test-token');

        const summary = sanitizeErrorSummary(error);
        expect(summary).toContain('[database-url]');
        expect(summary).toContain('[redacted]');
        expect(summary).not.toContain('postgres:5432');
        expect(summary).not.toContain('sk-test-token');
    });
});
