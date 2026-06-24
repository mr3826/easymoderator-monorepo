/**
 * provider.registry.test.js
 *
 * Verifies the registry resolves only the supported platform (facebook) and that
 * WhatsApp and Instagram are intentionally absent (Instagram removed 2026-06-24).
 */

'use strict';

const { getProvider, listProviders } = require('../provider.registry');
const MetaMessengerProvider = require('../providers/MetaMessengerProvider');

describe('provider.registry', () => {
    test('returns MetaMessengerProvider for "facebook"', () => {
        const p = getProvider('facebook');
        expect(p).toBeInstanceOf(MetaMessengerProvider);
        expect(p.platform).toBe('facebook');
    });

    test('throws for "instagram" — Instagram is removed from scope', () => {
        expect(() => getProvider('instagram')).toThrow(/Unsupported platform/);
    });

    test('throws for "whatsapp" — WhatsApp is removed from scope', () => {
        expect(() => getProvider('whatsapp')).toThrow(/Unsupported platform/);
    });

    test('throws for unknown platforms', () => {
        expect(() => getProvider('telegram')).toThrow(/Unsupported platform/);
        expect(() => getProvider('')).toThrow(/Unsupported platform/);
        expect(() => getProvider(null)).toThrow(/Unsupported platform/);
    });

    test('listProviders returns exactly facebook', () => {
        const list = listProviders();
        expect(list).toHaveLength(1);
        expect(list).toContain('facebook');
        expect(list).not.toContain('instagram');
        expect(list).not.toContain('whatsapp');
    });

    test('returned providers are singletons (same instance per call)', () => {
        expect(getProvider('facebook')).toBe(getProvider('facebook'));
    });
});
