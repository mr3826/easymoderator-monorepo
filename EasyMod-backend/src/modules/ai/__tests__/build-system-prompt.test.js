'use strict';

/**
 * intent-router.buildSystemPrompt() — operating-context grounding.
 *
 * The live payment/delivery block must be embedded in the system prompt so the
 * LLM trusts the shop's CURRENT settings over any seeded FAQ or persona example.
 */

process.env.NODE_ENV = 'test';

const { buildSystemPrompt } = require('src/modules/ai/intent-router.service');

const KNOWLEDGE = {
    businessInfo: { shopName: 'Test Shop', address: 'Dhaka' },
    brandingRules: {},
    faqs: [{ category: 'How can I pay?', template_en: 'You can pay via bKash, Nagad, or COD.' }],
};

test('operatingContext block is injected into the system prompt', () => {
    const operatingContext =
        '--- SHOP PAYMENT & DELIVERY ---\nAccepted payment: Cash on Delivery (COD) ONLY.';

    const prompt = buildSystemPrompt(KNOWLEDGE, 'mixed', false, 'friendly_bd', null, operatingContext);

    expect(prompt).toContain('SHOP PAYMENT & DELIVERY');
    expect(prompt).toContain('Cash on Delivery (COD) ONLY');
});

test('operatingContext appears ABOVE the FAQ section so it wins on conflict', () => {
    const operatingContext = 'Accepted payment: Cash on Delivery (COD) ONLY.';

    const prompt = buildSystemPrompt(KNOWLEDGE, 'mixed', false, 'friendly_bd', null, operatingContext);

    const ctxIdx = prompt.indexOf('Cash on Delivery (COD) ONLY');
    const faqIdx = prompt.indexOf('Frequently Asked Questions');
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(faqIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeLessThan(faqIdx);
});

test('omitting operatingContext keeps the prompt valid (backward compatible)', () => {
    const prompt = buildSystemPrompt(KNOWLEDGE, 'mixed', false, 'friendly_bd', null);

    expect(typeof prompt).toBe('string');
    expect(prompt).toContain('Test Shop');
    // No empty leading blank line artifact from the optional block.
    expect(prompt.startsWith('\n')).toBe(false);
});

test('default persona no longer hardcodes an advance-bKash payment example', () => {
    const prompt = buildSystemPrompt(KNOWLEDGE, 'mixed', false, 'friendly_bd', null, '');

    expect(prompt).not.toContain('Advance ta bKash korte hobe');
});
