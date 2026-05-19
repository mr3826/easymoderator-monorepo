/**
 * provider.registry.test.js
 *
 * Verifies registry resolves only the supported platforms (facebook, instagram)
 * and that WhatsApp is intentionally absent.
 */

'use strict';

const { getProvider, listProviders } = require('../provider.registry');
const MetaMessengerProvider = require('../providers/MetaMessengerProvider');
const MetaInstagramProvider = require('../providers/MetaInstagramProvider');

describe('provider.registry', () => {
    test('returns MetaMessengerProvider for "facebook"', () => {
        const p = getProvider('facebook');
        expect(p).toBeInstanceOf(MetaMessengerProvider);
        expect(p.platform).toBe('facebook');
    });

    test('returns MetaInstagramProvider for "instagram"', () => {
        const p = getProvider('instagram');
        expect(p).toBeInstanceOf(MetaInstagramProvider);
        expect(p.platform).toBe('instagram');
    });

    test('throws for "whatsapp" — WhatsApp is removed from scope', () => {
        expect(() => getProvider('whatsapp')).toThrow(/Unsupported platform/);
    });

    test('throws for unknown platforms', () => {
        expect(() => getProvider('telegram')).toThrow(/Unsupported platform/);
        expect(() => getProvider('')).toThrow(/Unsupported platform/);
        expect(() => getProvider(null)).toThrow(/Unsupported platform/);
    });

    test('listProviders returns exactly facebook and instagram', () => {
        const list = listProviders();
        expect(list).toHaveLength(2);
        expect(list).toContain('facebook');
        expect(list).toContain('instagram');
        expect(list).not.toContain('whatsapp');
    });

    test('returned providers are singletons (same instance per call)', () => {
        expect(getProvider('facebook')).toBe(getProvider('facebook'));
        expect(getProvider('instagram')).toBe(getProvider('instagram'));
    });
});
