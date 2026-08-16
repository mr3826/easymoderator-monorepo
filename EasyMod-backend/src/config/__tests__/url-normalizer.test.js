'use strict';

const {
    normalizeDatabaseUrl,
    normalizeQdrantUrl,
} = require('../url-normalizer');

describe('production URL normalization', () => {
    test('accepts a valid HTTP Qdrant URL', () => {
        expect(normalizeQdrantUrl('http://qdrant:6333')).toBe('http://qdrant:6333');
    });

    test('accepts a valid HTTPS Qdrant URL', () => {
        expect(normalizeQdrantUrl('https://qdrant.internal:6333')).toBe('https://qdrant.internal:6333');
    });

    test('trims surrounding whitespace', () => {
        expect(normalizeQdrantUrl('  http://qdrant:6333/  ')).toBe('http://qdrant:6333');
        expect(normalizeDatabaseUrl('  postgresql://user:pass@postgres:5432/easymod  '))
            .toBe('postgresql://user:pass@postgres:5432/easymod');
    });

    test('unwraps accidental literal surrounding quotes', () => {
        expect(normalizeQdrantUrl('"http://qdrant:6333"')).toBe('http://qdrant:6333');
        expect(normalizeDatabaseUrl('"postgresql://user:pass@postgres:5432/easymod"'))
            .toBe('postgresql://user:pass@postgres:5432/easymod');
    });

    test('accepts a Docker service hostname with an explicit port', () => {
        expect(new URL(normalizeQdrantUrl('http://qdrant:6333')).hostname).toBe('qdrant');
    });

    test('fails closed on malformed and missing URLs', () => {
        expect(() => normalizeQdrantUrl('http://http://qdrant:6333')).toThrow(/server-root/);
        expect(() => normalizeQdrantUrl('qdrant:6333')).toThrow(/allowed URL protocol/);
        expect(() => normalizeQdrantUrl('"http://qdrant:6333')).toThrow(/malformed surrounding quotes/);
        expect(() => normalizeQdrantUrl('')).toThrow(/QDRANT_URL is required/);
    });
});
