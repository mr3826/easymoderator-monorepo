'use strict';

/**
 * ai-messaging — pure builders for the greeting (with Meta AI-disclosure),
 * the order-confirmation closing, and the social-links block. No DB, no I/O.
 */

const {
    buildDisclosure,
    buildGreeting,
    renderSocialLinks,
    buildClosing,
} = require('../ai-messaging');
const { DEFAULT_AI_SETTINGS } = require('../shop-defaults');
const { validateAISettings } = require('../shop-settings.validator');

describe('ai-messaging · buildDisclosure', () => {
    it('interpolates the shop name in English', () => {
        expect(buildDisclosure('Rina Saree', 'en')).toBe(
            "🤖 You're chatting with Rina Saree's AI assistant."
        );
    });

    it('renders the Bangla disclosure', () => {
        expect(buildDisclosure('রিনা শাড়ি', 'bn')).toBe(
            '🤖 আপনি রিনা শাড়ি-এর AI সহকারীর সাথে কথা বলছেন।'
        );
    });

    it('falls back to mixed for unknown / missing language', () => {
        expect(buildDisclosure('Rina', 'klingon')).toBe(
            '🤖 Apni Rina-er AI assistant er sathe kotha bolchen.'
        );
        expect(buildDisclosure('Rina')).toBe(
            '🤖 Apni Rina-er AI assistant er sathe kotha bolchen.'
        );
    });

    it('uses a generic name when shopName is missing', () => {
        expect(buildDisclosure('', 'en')).toBe(
            "🤖 You're chatting with our shop's AI assistant."
        );
    });

    it('always begins with the 🤖 marker (Meta identifiability)', () => {
        for (const lang of ['en', 'bn', 'mixed']) {
            expect(buildDisclosure('Shop', lang).startsWith('🤖')).toBe(true);
        }
    });
});

describe('ai-messaging · buildGreeting', () => {
    const base = { shopName: 'Rina Saree', language: 'en' };

    it('returns empty string when greeting is disabled', () => {
        expect(buildGreeting({ ...base, greeting: { enabled: false, custom_text: 'hi' } })).toBe('');
    });

    it('returns empty string when greeting config is missing', () => {
        expect(buildGreeting({ ...base })).toBe('');
    });

    it('combines the disclosure and the owner custom text', () => {
        const out = buildGreeting({ ...base, greeting: { enabled: true, custom_text: 'Welcome! How can I help?' } });
        expect(out).toBe("🤖 You're chatting with Rina Saree's AI assistant.\n\nWelcome! How can I help?");
    });

    it('returns the disclosure alone when custom text is blank', () => {
        expect(buildGreeting({ ...base, greeting: { enabled: true, custom_text: '   ' } })).toBe(
            "🤖 You're chatting with Rina Saree's AI assistant."
        );
    });
});

describe('ai-messaging · renderSocialLinks', () => {
    it('returns empty string when no links are set', () => {
        expect(renderSocialLinks({}, 'en')).toBe('');
        expect(renderSocialLinks({ facebook: '', instagram: '   ' }, 'en')).toBe('');
        expect(renderSocialLinks(null, 'en')).toBe('');
    });

    it('renders only the filled links, in a stable order, under a header', () => {
        const out = renderSocialLinks(
            { facebook: 'https://fb.com/rina', whatsapp: '01711111111', website: 'https://rina.example' },
            'en'
        );
        expect(out).toBe(
            'Follow us:\nFacebook: https://fb.com/rina\nWhatsApp: 01711111111\nWebsite: https://rina.example'
        );
    });

    it('localizes the header for Bangla / mixed', () => {
        expect(renderSocialLinks({ facebook: 'https://fb.com/x' }, 'bn')).toBe(
            'আমাদের ফলো করুন:\nFacebook: https://fb.com/x'
        );
        expect(renderSocialLinks({ facebook: 'https://fb.com/x' }, 'mixed')).toBe(
            'আমাদের ফলো করুন:\nFacebook: https://fb.com/x'
        );
    });
});

describe('ai-messaging · buildClosing', () => {
    const socials = { facebook: 'https://fb.com/rina' };

    it('returns empty string when closing is disabled', () => {
        expect(buildClosing({ closing: { enabled: false, custom_text: 'thanks' }, socialLinks: socials, language: 'en' })).toBe('');
    });

    it('returns empty string when closing config is missing', () => {
        expect(buildClosing({ socialLinks: socials, language: 'en' })).toBe('');
    });

    it('returns the custom text alone when no social links are set', () => {
        expect(buildClosing({ closing: { enabled: true, custom_text: 'Thank you!' }, socialLinks: {}, language: 'en' })).toBe('Thank you!');
    });

    it('appends the social block after the custom text', () => {
        const out = buildClosing({ closing: { enabled: true, custom_text: 'Thank you!' }, socialLinks: socials, language: 'en' });
        expect(out).toBe('Thank you!\n\nFollow us:\nFacebook: https://fb.com/rina');
    });

    it('returns the social block alone when custom text is blank', () => {
        const out = buildClosing({ closing: { enabled: true, custom_text: '  ' }, socialLinks: socials, language: 'en' });
        expect(out).toBe('Follow us:\nFacebook: https://fb.com/rina');
    });

    it('returns empty string when enabled but nothing to say', () => {
        expect(buildClosing({ closing: { enabled: true, custom_text: '' }, socialLinks: {}, language: 'en' })).toBe('');
    });
});

describe('ai-messaging · seeded defaults', () => {
    it('ships an enabled greeting + closing with non-empty text', () => {
        expect(DEFAULT_AI_SETTINGS.greeting).toMatchObject({ enabled: true });
        expect(DEFAULT_AI_SETTINGS.greeting.custom_text.trim().length).toBeGreaterThan(0);
        expect(DEFAULT_AI_SETTINGS.closing).toMatchObject({ enabled: true });
        expect(DEFAULT_AI_SETTINGS.closing.custom_text.trim().length).toBeGreaterThan(0);
    });

    it('default greeting/closing pass the settings validator', () => {
        expect(() => validateAISettings({
            greeting: DEFAULT_AI_SETTINGS.greeting,
            closing: DEFAULT_AI_SETTINGS.closing,
        })).not.toThrow();
    });

    it('builds a non-empty greeting from the defaults (disclosure + text)', () => {
        const out = buildGreeting({ shopName: 'Rina', language: 'mixed', greeting: DEFAULT_AI_SETTINGS.greeting });
        expect(out).toContain('🤖');
        expect(out.length).toBeGreaterThan(buildDisclosure('Rina', 'mixed').length);
    });
});
