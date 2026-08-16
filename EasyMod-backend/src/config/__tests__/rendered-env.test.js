'use strict';

const {
    decodeRenderedEnvValue,
    normalizeRenderedEnvironment,
    serializeRenderedEnvValue,
} = require('../rendered-env');

describe('production environment serialization', () => {
    test('decodes a legacy JSON-serialized value without logging or changing content', () => {
        expect(decodeRenderedEnvValue(JSON.stringify('https://api.easymod.tech')))
            .toBe('https://api.easymod.tech');

        const valueWithQuotes = '"credential-value"';
        expect(decodeRenderedEnvValue(JSON.stringify(valueWithQuotes))).toBe(valueWithQuotes);
    });

    test('leaves ordinary and malformed values untouched for fail-closed validation', () => {
        expect(decodeRenderedEnvValue('https://api.easymod.tech')).toBe('https://api.easymod.tech');
        expect(decodeRenderedEnvValue('"unterminated')).toBe('"unterminated');
    });

    test('normalizes a copy of a fully JSON-serialized production environment', () => {
        const source = {
            API_URL: 'https://api.easymod.tech',
            CHANNEL_ENCRYPTION_KEY: 'a'.repeat(64),
        };
        const serialized = Object.fromEntries(
            Object.entries(source).map(([name, value]) => [name, JSON.stringify(value)]),
        );

        expect(normalizeRenderedEnvironment(serialized)).toEqual(source);
        expect(serialized.API_URL).toBe(JSON.stringify(source.API_URL));
    });

    test('rejects newline and NUL injection in Docker env-file values', () => {
        expect(() => serializeRenderedEnvValue('line\nvalue', 'SESSION_SECRET'))
            .toThrow(/SESSION_SECRET cannot contain newlines/);
        expect(() => serializeRenderedEnvValue('value\u0000', 'API_URL'))
            .toThrow(/API_URL cannot contain newlines/);
    });
});
