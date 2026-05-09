'use strict';

const { detectLanguage } = require('../language-switcher.service');

describe('detectLanguage()', () => {
    // ─── Edge cases: null / empty ───────────────────────────────────────────────

    test('null input returns { language: "en", confidence: 0 }', () => {
        const result = detectLanguage(null);
        expect(result).toEqual({ language: 'en', confidence: 0 });
    });

    test('empty string returns { language: "en", confidence: 0 }', () => {
        const result = detectLanguage('');
        expect(result).toEqual({ language: 'en', confidence: 0 });
    });

    test('whitespace-only string returns { language: "en", confidence: 0 }', () => {
        const result = detectLanguage('   ');
        expect(result).toEqual({ language: 'en', confidence: 0 });
    });

    test('non-string number input returns { language: "en", confidence: 0 }', () => {
        const result = detectLanguage(12345);
        expect(result).toEqual({ language: 'en', confidence: 0 });
    });

    test('boolean input returns { language: "en", confidence: 0 }', () => {
        const result = detectLanguage(true);
        expect(result).toEqual({ language: 'en', confidence: 0 });
    });

    // ─── Bengali detection ───────────────────────────────────────────────────────

    test('pure Bengali "আমি ভালো আছি" → bn with confidence >= 0.7', () => {
        const result = detectLanguage('আমি ভালো আছি');
        expect(result.language).toBe('bn');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    test('longer pure Bengali sentence → bn', () => {
        const result = detectLanguage('আজকে আবহাওয়া অনেক সুন্দর। আমি বাইরে যাব।');
        expect(result.language).toBe('bn');
        expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    test('Bengali script dominates mixed text → bn', () => {
        // Bengali chars make up clearly more than 40% of non-space chars
        const result = detectLanguage('আমি order দিতে চাই');
        expect(result.language).toBe('bn');
    });

    // ─── Banglish detection ──────────────────────────────────────────────────────

    test('"ami tumi kemon acho bhai" → banglish', () => {
        const result = detectLanguage('ami tumi kemon acho bhai');
        expect(result.language).toBe('banglish');
    });

    test('commerce Banglish "order delivery daam pathao" → banglish', () => {
        const result = detectLanguage('order delivery daam pathao');
        expect(result.language).toBe('banglish');
    });

    test('"Apni ki acho bhai product ta pathao" → banglish (multiple patterns)', () => {
        const result = detectLanguage('Apni ki acho bhai product ta pathao');
        expect(result.language).toBe('banglish');
    });

    test('Banglish with formal address "apni ki janain" → banglish', () => {
        const result = detectLanguage('apni ki janain price ta koto');
        expect(result.language).toBe('banglish');
    });

    test('Banglish confidence is between 0 and 1', () => {
        const result = detectLanguage('ami kemon acho bhai pathao');
        expect(result.language).toBe('banglish');
        expect(result.confidence).toBeGreaterThan(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });

    // ─── English detection ───────────────────────────────────────────────────────

    test('"Hello how are you today" → en with confidence >= 0.5', () => {
        const result = detectLanguage('Hello how are you today');
        expect(result.language).toBe('en');
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    test('phone number text with +880 prefix → en (non-Bengali, no Banglish patterns)', () => {
        const result = detectLanguage('+8801712345678');
        expect(result.language).toBe('en');
    });

    test('numeric string → en (no latin or bengali chars; falls through to ambiguous default)', () => {
        // A string of only digits has no Bengali script and no Latin letters,
        // so it hits the ambiguous fallback branch: { language: 'en', confidence: 0.3 }.
        const result = detectLanguage('1234567890');
        expect(result.language).toBe('en');
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });

    test('plain English sentence → en', () => {
        const result = detectLanguage('Please ship the package to this address as soon as possible.');
        expect(result.language).toBe('en');
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
    });

    // ─── Return shape invariants ─────────────────────────────────────────────────

    test('result always has language and confidence keys', () => {
        const inputs = [null, '', 'hello', 'আমি', 'ami kemon'];
        inputs.forEach(input => {
            const result = detectLanguage(input);
            expect(result).toHaveProperty('language');
            expect(result).toHaveProperty('confidence');
            expect(['bn', 'en', 'banglish']).toContain(result.language);
            expect(result.confidence).toBeGreaterThanOrEqual(0);
            expect(result.confidence).toBeLessThanOrEqual(1);
        });
    });
});
