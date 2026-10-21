'use strict';

const { scrubPII } = require('../prompt-sanitizer.service');

describe('customer prompt PII scrubbing', () => {
    test.each([
        ['ASCII spaced phone', 'Call 01712 345 678 now', '[PHONE]'],
        ['ASCII hyphenated phone', 'Call +880-1712-345678 now', '[PHONE]'],
        ['Bengali digits', 'কল করুন ০১৭১২৩৪৫৬৭৮ এখন', '[PHONE]'],
        ['Bengali digits with separators', 'কল করুন ০১৭১২-৩৪৫-৬৭৮ এখন', '[PHONE]'],
    ])('scrubs %s without losing the surrounding question', (_label, value, placeholder) => {
        const result = scrubPII(value);
        expect(result).toContain(placeholder);
        expect(result).not.toMatch(/[০-৯]/);
        expect(result).not.toMatch(/\d{8,}/);
    });

    test('continues to scrub email and leave non-contact commerce text readable', () => {
        expect(scrubPII('mail a.person+shop@example.com about size 42')).toBe('mail [EMAIL] about size 42');
        expect(scrubPII('What is the price for size 32?')).toBe('What is the price for size 32?');
    });
});
