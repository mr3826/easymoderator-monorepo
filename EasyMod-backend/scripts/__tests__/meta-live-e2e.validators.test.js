'use strict';

/**
 * Grading helpers for the real-Meta live runner.
 *
 * These decide whether a certification step passed, so a bug here is worse than
 * a bug in the thing being certified: it can hide a wrong price, or fail a
 * correct one. Both happened — see the Bengali-numeral case below.
 */

const {
    statesPrice,
    priceClaims,
    validateRelatedAlternativeClaims,
    isTerminalReply,
} = require('../meta-live-e2e');

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

describe('NOT_FOUND alternative provenance', () => {
    const SHOP = 'shop-test';
    const OTHER_SHOP = 'shop-other';
    const catalog = new Map([
        ['related-a', { id: 'related-a', shop_id: SHOP, price: 690 }],
        ['related-b', { id: 'related-b', shop_id: SHOP, price: 1190 }],
        ['other-shop', { id: 'other-shop', shop_id: OTHER_SHOP, price: 690 }],
    ]);

    const proof = (text, sourceReferences, products = catalog) =>
        validateRelatedAlternativeClaims({
            text,
            sourceReferences,
            catalogProducts: products,
            shopId: SHOP,
        });

    test('allows a NOT_FOUND response with no alternatives and no price', () => {
        expect(proof('We do not have that product.', [])).toMatchObject({ ok: true, claims: [] });
    });

    test('allows exact prices for two same-shop related alternatives', () => {
        expect(proof(
            'We do not have that item. Premium alternative is 690 taka and another is 1190 taka.',
            [{ kind: 'product', id: 'related-a' }, { kind: 'product', id: 'related-b' }],
        )).toMatchObject({ ok: true, unsupportedPrices: [] });
    });

    test('rejects a related product belonging to another shop', () => {
        expect(proof(
            'An alternative costs 690 taka.',
            [{ kind: 'product', id: 'other-shop' }],
        )).toMatchObject({ ok: false, wrongShopProductIds: ['other-shop'] });
    });

    test('rejects a fabricated price when no related evidence exists', () => {
        expect(proof('That item costs 690 taka.', [])).toMatchObject({ ok: false, claims: ['690'] });
    });

    test('rejects a price that differs from the related catalog row', () => {
        expect(proof(
            'The alternative costs 999 taka.',
            [{ kind: 'product', id: 'related-a' }],
        )).toMatchObject({ ok: false, unsupportedPrices: ['999'] });
    });

    test('rejects a source reference that cannot be reconstructed from the catalog', () => {
        expect(proof(
            'The alternative costs 690 taka.',
            [{ kind: 'product', id: 'missing-product' }],
        )).toMatchObject({ ok: false, missingProductIds: ['missing-product'] });
    });

    test('rejects a model-only price even when conversation history contains it', () => {
        expect(proof('As mentioned earlier, it costs 690 taka.', [])).toMatchObject({
            ok: false,
            claims: ['690'],
        });
    });
});

describe('live reply terminal-state observation', () => {
    test('does not treat the initial provider claim as a completed send', () => {
        expect(isTerminalReply({ metadata: {
            delivered: false,
            provider_send_attempted: true,
            delivery_state: 'SEND_PENDING',
        } })).toBe(false);
    });

    test.each(['SENT', 'FAILED', 'HELD', 'DRAFT_READY', 'DISMISSED'])('%s is terminal', (deliveryState) => {
        expect(isTerminalReply({ metadata: { delivered: false, delivery_state: deliveryState } })).toBe(true);
    });

    test('provider confirmation is terminal even when a legacy state is absent', () => {
        expect(isTerminalReply({ metadata: { delivered: true, provider_send_confirmed: true } })).toBe(true);
    });
});
