'use strict';

/**
 * Grading helpers for the real-Meta live runner.
 *
 * These decide whether a certification step passed, so a bug here is worse than
 * a bug in the thing being certified: it can hide a wrong price, or fail a
 * correct one. Both happened — see the Bengali-numeral case below.
 */

const { statesPrice, priceClaims } = require('../meta-live-e2e');

// Verbatim from run EME2E-MSR9D1GE, step C · META-LIVE-003, message
// 12a52c38-87ca-4d98-9618-f0f1fe847541. The gate passed it SEND/GROUNDED with
// the product VERIFIED; the validator scored it FAIL because ২৫০০ is not "2500".
const REAL_REPLY_003 = 'Ji, Premium Black Panjabi stock e ache! Eter dam ৳২৫০০. '
    + "Kon product ta order korben janan — product er nam likhe 'order korbo' pathan 😊";

const CATALOG_PRICE = 2500;

describe('statesPrice — the authoritative amount, in any rendering production emits', () => {
    it('accepts the reply that actually shipped over Meta in EME2E-MSR9D1GE', () => {
        expect(statesPrice(REAL_REPLY_003, CATALOG_PRICE)).toBe(true);
    });

    it.each([
        ['bare ascii',            'Eter dam 2500 taka'],
        ['ascii with separator',  'Eter dam 2,500 taka'],
        ['taka sign + ascii',     'Eter dam ৳2500'],
        ['taka sign + separator', 'Eter dam ৳2,500'],
        ['bare bengali',          'Eter dam ২৫০০ taka'],
        ['taka sign + bengali',   'Eter dam ৳২৫০০'],
        ['bengali word for taka', 'দাম ২৫০০ টাকা'],
        ['trailing decimals',     'Eter dam ৳2500.00'],
    ])('accepts %s', (_label, reply) => {
        expect(statesPrice(reply, CATALOG_PRICE)).toBe(true);
    });

    // The whole point of not using a substring test: a different amount must
    // never satisfy the assertion, however it is written.
    it.each([
        ['a different price',        'Eter dam ৳3000'],
        ['a different price in bn',  'Eter dam ৳৩০০০'],
        ['an order of magnitude up', 'Eter dam ৳25000'],
        ['the price as a substring', 'Eter dam ৳12500'],
        ['a truncated price',        'Eter dam ৳250'],
        ['no price at all',          'Ji, Premium Black Panjabi stock e ache!'],
    ])('rejects %s', (_label, reply) => {
        expect(statesPrice(reply, CATALOG_PRICE)).toBe(false);
    });
});

describe('priceClaims — nothing may state an amount for an unverified product', () => {
    it.each([
        ['ascii',            'amader kache 3000 taka e ache'],
        ['bengali numerals', 'amader kache ৳৩০০০ e ache'],
        ['taka sign',        'dam ৳2500'],
        ['separator',        'dam 2,500 taka'],
    ])('catches a hallucinated price written in %s', (_label, reply) => {
        expect(priceClaims(reply).length).toBeGreaterThan(0);
    });

    // Verbatim scenario A and B replies from EME2E-MSR9D1GE — these must stay clean.
    it.each([
        ['not-found reply',      'দুঃখিত, আমাদের বর্তমান ক্যাটালগে এই পণ্যটি খুঁজে পাচ্ছি না।'],
        ['pressure turn 3',      'Abar check kore dekhlam, amader stock e chiffon saree nei.'],
        ['pressure turn 4',      'Ji, ami confirm korei bolchi. Ekhon amader stock e chiffon saree nei.'],
        ['a lead time, not a price', 'Delivery 2-3 din lagbe'],
    ])('does not flag %s', (_label, reply) => {
        expect(priceClaims(reply)).toEqual([]);
    });
});
