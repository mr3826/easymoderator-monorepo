'use strict';

process.env.NODE_ENV = 'test';
process.env.API_URL = 'https://api.easymod.tech';
process.env.PUBLIC_ASSET_URL = 'https://assets.easymod.tech';

const grounding = require('src/modules/ai/grounding');
const { evaluateCandidate } = require('src/modules/ai/grounding/outbound-grounding.gate');

const SHOP = 'shop-a';
const OTHER_SHOP = 'shop-b';

const catalogProduct = (overrides = {}) => ({
    id: 'product-1',
    shop_id: SHOP,
    name: 'Classic Blue Denim Jacket',
    category: 'jacket',
    price: 3200,
    in_stock: true,
    track_quantity: false,
    quantity: 0,
    is_active: true,
    variants: [],
    images: [],
    tags: [],
    ai_material: 'cotton',
    ai_color: 'black',
    ...overrides,
});

describe('product evidence trust boundaries', () => {
    test('a candidate explicitly owned by a different shop cannot verify here', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct({ shop_id: OTHER_SHOP })],
        });

        expect(evidence.productStatus).toBe(grounding.ProductEvidenceStatus.NOT_FOUND);
        expect(evidence.verifiedProducts).toEqual([]);
    });

    test('a candidate without an explicit tenant owner cannot verify', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct({ shop_id: null })],
        });

        expect(evidence.productStatus).toBe(grounding.ProductEvidenceStatus.NOT_FOUND);
        expect(evidence.verifiedProducts).toEqual([]);
    });

    test('context product rows are filtered by explicit tenant owner', () => {
        const evidence = grounding.resolveContextualAttributeEvidence({
            shopId: SHOP,
            message: 'cotton?',
            contextProducts: [catalogProduct({ shop_id: OTHER_SHOP })],
        });

        expect(evidence.productStatus).toBe(grounding.ProductEvidenceStatus.NONE);
        expect(evidence.verifiedProducts).toEqual([]);
    });

    test('merchant-provided aliases resolve a supported spelling without fuzzy inference', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Premium Black Punjabi price?',
            candidates: [catalogProduct({
                name: 'Premium Black Panjabi',
                aliases: ['Punjabi'],
            })],
        });

        expect(evidence.productStatus).toBe(grounding.ProductEvidenceStatus.VERIFIED);
        expect(evidence.verifiedProducts[0].name).toBe('Premium Black Panjabi');
    });

    test('AI-derived material and color stay uncertain rather than merchant facts', () => {
        const facts = grounding.buildFacts(catalogProduct());

        expect(facts.material.state).toBe(grounding.FactState.UNCERTAIN);
        expect(facts.color.state).toBe(grounding.FactState.UNCERTAIN);
    });

    test('size is represented under the attribute key consumed by grounding', () => {
        const facts = grounding.buildFacts(catalogProduct());

        expect(facts.size.state).toBe(grounding.FactState.UNKNOWN);
        expect(facts.size.value).toBeNull();
    });

    test('variant price is accepted only for the explicitly named option', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket XL size price?',
            candidates: [catalogProduct({
                variants: [{ id: 'variant-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 2, is_active: true }],
            })],
        });

        const namedOption = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket XL size is 3300 taka.',
            evidence,
            language: 'en',
        });
        const mismatchedOption = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket L size is 3300 taka.',
            evidence,
            language: 'en',
        });

        expect(namedOption.decision).toBe(grounding.GroundingDecision.SEND);
        expect(mismatchedOption.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(mismatchedOption.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    });

    test('XXL size labels are not mistaken for foreign currency codes', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket XXL size price?',
            candidates: [catalogProduct({
                variants: [{ id: 'variant-xxl', option_name: 'Size', option_value: 'XXL', price: 3300, quantity: 2, is_active: true }],
            })],
        });

        expect(evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket size XXL 3,300 taka.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('unequal variant prices require an explicitly named variant for the price claim', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct({
                variants: [
                    { id: 'variant-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                    { id: 'variant-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
                ],
            })],
        });

        const unscoped = evaluateCandidate({ candidate: '3,200 taka', evidence, language: 'en' });
        const selected = evaluateCandidate({ candidate: 'XL size costs ৳3,300.', evidence, language: 'en' });
        const mismatched = evaluateCandidate({ candidate: 'XL size costs ৳3,200.', evidence, language: 'en' });

        expect(unscoped.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(selected.decision).toBe(grounding.GroundingDecision.SEND);
        expect(mismatched.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test('a generic product-name price claim remains valid when its price is unambiguous', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });

        expect(evaluateCandidate({
            candidate: 'The jacket costs ৳3,200.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        expect(evaluateCandidate({
            candidate: 'The jacket costs 3,200 BDT.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('a missing parent and variant price stays unknown instead of becoming zero', () => {
        const facts = grounding.buildFacts(catalogProduct({
            price: null,
            variants: [{ id: 'variant-32', option_name: 'Size', option_value: '32', price: null, quantity: 1, is_active: true }],
        }));

        expect(facts.price).toEqual({ state: grounding.FactState.UNKNOWN, value: null });
        expect(facts.variants[0].price).toEqual({ state: grounding.FactState.UNKNOWN, value: null });
    });

    test('a delivery fee cannot authorize a different product price', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });
        grounding.withPolicyText(evidence, 'Delivery charge inside Dhaka is 60 taka.');

        const verdict = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket er price 60 taka.',
            evidence,
            language: 'mixed',
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    });

    test('a nearby delivery fee cannot authorize a same-valued jacket price', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });
        grounding.withPolicyText(evidence, 'Delivery charge is 60 taka.');

        const verdict = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket price 60 taka, delivery charge 60 taka.',
            evidence,
            language: 'en',
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    });

    test('a separately labeled policy fee stays valid after a verified product price', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });
        grounding.withPolicyText(evidence, 'Delivery fee is ৳60.');

        for (const candidate of [
            'Classic Blue Denim Jacket price is ৳3,200 + ৳60 delivery fee.',
            'Classic Blue Denim Jacket costs ৳3,200 plus ৳60 delivery fee.',
            'Classic Blue Denim Jacket price is ৳3,200 and ৳60 delivery fee.',
        ]) {
            expect(evaluateCandidate({ candidate, evidence, language: 'en' }).decision)
                .toBe(grounding.GroundingDecision.SEND);
        }
    });

    test('delivery fee in the same sentence cannot become a product price', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });
        grounding.withPolicyText(evidence, 'Delivery fee is ৳60.');

        const verdict = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket price is ৳60 including delivery.',
            evidence,
            language: 'en',
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    });

    test('a delivery-fee label cannot reclassify a nearby product price or cost', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });
        grounding.withPolicyText(evidence, 'Delivery fee is ৳60.');

        for (const candidate of [
            'Classic Blue Denim Jacket price with delivery cost is ৳60.',
            'Jacket price after delivery fee is ৳60.',
            'Classic Blue Denim Jacket costs ৳60 with delivery fee.',
            'Classic Blue Denim Jacket is only ৳60 with delivery fee.',
            'Jacket is ৳60 including delivery fee.',
            'Red Handbag is only ৳60 with delivery fee.',
            'The jacket will be ৳60 with delivery fee.',
            'Jacket will be on sale for ৳60 with delivery fee.',
            'Jacket is on sale for ৳60 with delivery fee.',
            'Classic Blue Denim Jacket selling for ৳60 with delivery fee.',
            'Classic Blue Denim Jacket listed for ৳60 with delivery fee.',
            'Classic Blue Denim Jacket is priced at ৳60 with delivery fee.',
            'Jacket ৳60 with delivery fee.',
            'Classic Blue Denim Jacket: ৳60 (delivery fee extra).',
            'Classic Blue Denim Jacket — ৳60 + delivery fee.',
            'Jacket: 60 taka delivery fee included.',
            'Jacket. 60 with delivery fee.',
            'The jacket. It is 60 with delivery fee.',
        ]) {
            const verdict = evaluateCandidate({ candidate, evidence, language: 'en' });
            expect({ candidate, decision: verdict.decision }).toEqual({
                candidate,
                decision: grounding.GroundingDecision.SAFE_FALLBACK,
            });
            expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
        }
    });

    test('an amount that is equally valid as product price and fee needs explicit separation', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct({ price: 60 })],
        });
        grounding.withPolicyText(evidence, 'Delivery fee is ৳60.');

        for (const candidate of [
            'Jacket. 60 with delivery fee.',
            'The jacket. It is 60 with delivery fee.',
        ]) {
            const verdict = evaluateCandidate({ candidate, evidence, language: 'en' });
            expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
            expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
        }
    });

    test('product price and stock claims stay bound to the verified product identity', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });

        for (const candidate of [
            'The Red Handbag costs ৳3,200.',
            'The Red Handbag is available in stock.',
        ]) {
            const verdict = evaluateCandidate({ candidate, evidence, language: 'en' });
            expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        }

        expect(evaluateCandidate({
            candidate: '৳3,200', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('a bare amount is ambiguous when multiple verified products are present', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'denim jacket price?',
            candidates: [
                catalogProduct({ price: 3200 }),
                catalogProduct({ id: 'product-2', name: 'Premium Blue Denim Jacket', price: 3200 }),
            ],
        });

        const verdict = evaluateCandidate({ candidate: '৳3,200', evidence, language: 'en' });
        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test('a price from another verified product cannot be attributed to this one', () => {
        const jacket = catalogProduct();
        const panjabi = catalogProduct({
            id: 'product-2',
            name: 'Premium Black Panjabi',
            category: 'panjabi',
            price: 2500,
            variants: [],
        });
        const evidence = grounding.emptyEvidence(SHOP);
        evidence.productStatus = grounding.ProductEvidenceStatus.VERIFIED;
        evidence.verifiedProducts = [jacket, panjabi].map(product => ({
            id: product.id,
            shopId: SHOP,
            name: product.name,
            facts: grounding.buildFacts(product),
            imageUrl: null,
        }));

        const verdict = evaluateCandidate({
            candidate: 'Premium Black Panjabi er dam 3200 taka.',
            evidence,
            language: 'mixed',
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
    });

    test('a size is not claimed available when its active variant has no stock', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket size XL available?',
            candidates: [catalogProduct({
                variants: [{ id: 'variant-xl', option_name: 'Size', option_value: 'XL', price: null, quantity: 0, is_active: true }],
            })],
        });

        const verdict = evaluateCandidate({
            candidate: 'XL size available ache.',
            evidence,
            language: 'mixed',
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN);
    });

    test('a truthful product-level not-available reply is accepted', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket available?',
            candidates: [catalogProduct({ in_stock: false })],
        });
        const verdict = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket is not available.',
            evidence,
            language: 'en',
            modelGenerated: true,
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('delivery availability is not treated as product stock', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket available?',
            candidates: [catalogProduct({ in_stock: false })],
        });
        grounding.withPolicyText(evidence, 'Delivery is available nationwide across Bangladesh.');
        const verdict = evaluateCandidate({
            candidate: 'Delivery is available nationwide across Bangladesh.',
            evidence,
            language: 'en',
            modelGenerated: true,
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('mixed exact variant states validate independently within one reply', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket size M and XL available?',
            candidates: [catalogProduct({
                variants: [
                    { id: 'variant-m', option_name: 'Size', option_value: 'M', quantity: 1, is_active: true },
                    { id: 'variant-xl', option_name: 'Size', option_value: 'XL', quantity: 0, is_active: true },
                ],
            })],
        });
        const verdict = evaluateCandidate({
            candidate: 'M is available, but XL is unavailable.',
            evidence,
            language: 'en',
            modelGenerated: true,
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('unknown arbitrary size values are not treated as product-level availability', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket size 42 available?',
            candidates: [catalogProduct({
                variants: [{ id: 'variant-xl', option_name: 'Size', option_value: 'XL', quantity: 1, is_active: true }],
            })],
        });
        const verdict = evaluateCandidate({
            candidate: 'Size 42 is available.',
            evidence,
            language: 'en',
            modelGenerated: true,
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN);
    });

    test('an unrelated unknown fact does not excuse an unsupported delivery timeline', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });
        const verdict = evaluateCandidate({
            candidate: 'We will deliver tomorrow, but the material is unknown.',
            evidence,
            language: 'en',
            modelGenerated: true,
        });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    });

    test('another tenant upload URL cannot be presented as this product media', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket photo please',
            candidates: [catalogProduct({
                image_url: 'https://api.easymod.tech/uploads/product-images/shop-b/stolen.jpg',
                variants: [{
                    id: 'variant-xl', option_name: 'Size', option_value: 'XL', quantity: 1,
                    is_active: true, attributes: { image_url: 'https://api.easymod.tech/uploads/product-images/shop-b/variant.jpg' },
                }],
            })],
        });

        expect(evidence.productStatus).toBe(grounding.ProductEvidenceStatus.VERIFIED);
        expect(evidence.mediaStatus).toBe(grounding.MediaStatus.UNAVAILABLE);
        expect(evidence.mediaUrl).toBeNull();
        expect(evidence.verifiedProducts[0].facts.variants[0].imageUrl).toBeNull();
    });

    test('a same-tenant upload path on an untrusted or local origin is unavailable', () => {
        for (const image_url of [
            'https://evil.example/uploads/product-images/shop-a/spoofed.jpg',
            'https://127.0.0.1/uploads/product-images/shop-a/spoofed.jpg',
            'https://user@api.easymod.tech/uploads/product-images/shop-a/spoofed.jpg',
        ]) {
            const evidence = grounding.resolveProductEvidence({
                shopId: SHOP,
                message: 'Classic Blue Denim Jacket photo please',
                candidates: [catalogProduct({ image_url })],
            });

            expect(evidence.mediaStatus).toBe(grounding.MediaStatus.UNAVAILABLE);
            expect(evidence.mediaUrl).toBeNull();
        }
    });

    test('product media accepts only the configured public asset and API origins', () => {
        expect(grounding.isTenantOwnedMediaUrl(
            'https://assets.easymod.tech/uploads/product-images/shop-a/image.jpg', SHOP,
        )).toBe(true);
        expect(grounding.isTenantOwnedMediaUrl(
            'https://api.easymod.tech/uploads/product-images/shop-a/image.jpg', SHOP,
        )).toBe(true);
    });

    test('multiple matching products never select an arbitrary product image', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'denim jacket photo please',
            candidates: [
                catalogProduct({ image_url: 'https://api.easymod.tech/uploads/product-images/shop-a/jacket-1.jpg' }),
                catalogProduct({ id: 'product-2', name: 'Premium Blue Denim Jacket', image_url: 'https://api.easymod.tech/uploads/product-images/shop-a/jacket-2.jpg' }),
            ],
        });

        expect(evidence.verifiedProducts).toHaveLength(2);
        expect(evidence.mediaStatus).toBe(grounding.MediaStatus.AMBIGUOUS);
        expect(evidence.mediaUrl).toBeNull();
        expect(evidence.allowedUrls).toEqual([]);
    });

    test('product context expires after 24 hours and cannot be revived from an older turn', () => {
        const now = Date.parse('2026-10-20T00:00:00.000Z');
        const refs = [{ kind: 'product', id: 'product-1' }];

        expect(grounding.contextProductIds([{
            role: 'assistant',
            createdAt: '2026-10-19T23:59:00.000Z',
            sourceReferences: refs,
        }], { now })).toEqual(['product-1']);
        expect(grounding.contextProductIds([{
            role: 'assistant',
            createdAt: '2026-10-18T23:59:00.000Z',
            sourceReferences: refs,
        }], { now })).toEqual([]);
    });

    test('selected variants are recovered only from the latest same-shop grounded presentation', () => {
        const history = [{
            role: 'assistant',
            sourceReferences: [{ kind: 'product', id: 'product-1' }],
            productPresentation: {
                shopId: SHOP,
                products: [{
                    id: 'product-1',
                    selectedVariant: { id: 'variant-xl', option: 'Size', value: 'XL' },
                }],
            },
        }];

        expect(grounding.contextSelectedVariants(history, { shopId: SHOP })).toEqual({
            'product-1': { id: 'variant-xl', option: 'Size', value: 'XL' },
        });
        expect(grounding.contextSelectedVariants(history, { shopId: OTHER_SHOP })).toEqual({});
        expect(grounding.contextSelectedVariants([
            ...history,
            { role: 'assistant', sourceReferences: null, productPresentation: history[0].productPresentation },
        ], { shopId: SHOP })).toEqual({});
    });

    test('unknown-attribute fallback suppresses an ambiguous parent price', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket material?',
            candidates: [catalogProduct({
                ai_material: null,
                variants: [
                    { id: 'variant-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                    { id: 'variant-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
                ],
            })],
        });
        const verdict = evaluateCandidate({
            candidate: 'Classic Blue Denim Jacket is silk.',
            evidence,
            language: 'en',
        });

        expect(verdict.reasonCode).toBe(grounding.ReasonCode.PRODUCT_ATTRIBUTE_UNKNOWN);
        expect(verdict.text).toContain('Classic Blue Denim Jacket');
        expect(verdict.text).not.toContain('৳3200');
        expect(verdict.text).not.toContain('৳3300');
    });

    test('invalid and future product-reference timestamps fail closed', () => {
        const refs = [{ kind: 'product', id: 'product-1' }];
        const now = Date.parse('2026-10-20T00:00:00.000Z');

        for (const createdAt of ['not-a-date', '2026-10-20T00:10:00.000Z']) {
            expect(grounding.contextProductIds([{
                role: 'assistant',
                createdAt,
                sourceReferences: refs,
            }], { now })).toEqual([]);
        }
    });

    test('a newer assistant turn without product references invalidates an older selection', () => {
        expect(grounding.contextProductIds([
            { role: 'assistant', sourceReferences: [{ kind: 'product', id: 'product-1' }] },
            { role: 'user', content: 'No, a different item' },
            { role: 'assistant', sourceReferences: null },
        ])).toEqual([]);
    });

    test.each([
        ['wrong stock claim', 'Classic Blue Denim Jacket is out of stock.'],
        ['unsupported delivery promise', 'We will deliver the jacket tomorrow.'],
        ['fabricated payment and order confirmation', 'Your payment is received and your order is confirmed.'],
    ])('%s is blocked at the outbound boundary', (_label, candidate) => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });

        const verdict = evaluateCandidate({ candidate, evidence, language: 'en' });

        expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    });

    test('a policy amount is supported when the reply identifies it as a delivery fee', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence, 'Delivery charge inside Dhaka is 60 taka.');

        for (const candidate of [
            'Inside Dhaka delivery charge 60 taka.',
            'Dhaka te delivery charge 60 taka.',
        ]) {
            const verdict = evaluateCandidate({ candidate, evidence, language: 'mixed' });
            expect(verdict.decision).toBe(grounding.GroundingDecision.SEND);
        }

        for (const candidate of [
            'Outside Dhaka delivery charge 60 taka.',
            'Delivery fee is only ৳60.',
        ]) {
            const verdict = evaluateCandidate({ candidate, evidence, language: 'mixed' });
            expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
            expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
        }
    });

    test('a location-specific policy fee cannot be reassigned to another location', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence,
            'Inside Dhaka delivery fee is ৳60. Outside Dhaka delivery fee is ৳120.');

        expect(evaluateCandidate({
            candidate: 'Delivery fee inside Dhaka is ৳60.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        expect(evaluateCandidate({
            candidate: 'Outside Dhaka delivery fee is ৳120.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);

        for (const candidate of [
            'Delivery fee inside Dhaka is ৳120.',
            'Outside Dhaka delivery fee is ৳60.',
            'Delivery fee is ৳60.',
        ]) {
            const verdict = evaluateCandidate({ candidate, evidence, language: 'en' });
            expect(verdict.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
            expect(verdict.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_PRICE_CLAIM);
        }
    });

    test('a general fee policy supports an unscoped fee statement', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence, 'The delivery fee is ৳60.');

        expect(evaluateCandidate({
            candidate: '60 taka delivery charge.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('an explicit plus connector separates an equal product price from its delivery fee', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct({ price: 60 })],
        });
        grounding.withPolicyText(evidence, 'Delivery fee is ৳60.');

        const candidate = 'Classic Blue Denim Jacket price is ৳60 + ৳60 delivery fee.';
        expect(grounding.unsupportedPriceClaims(candidate, evidence)).toEqual([]);
        expect(evaluateCandidate({
            candidate,
            evidence,
            language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('a fee for one policy category cannot authorize another category', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence, 'Return fee is ৳60.');

        expect(evaluateCandidate({
            candidate: 'Delivery fee is ৳60.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'Return fee is ৳60.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('Bangla location-specific fee rates preserve inside and outside scope', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence,
            'ঢাকার ভিতরে ডেলিভারি চার্জ ৬০ টাকা। ঢাকার বাইরে ডেলিভারি চার্জ ১২০ টাকা।');

        expect(evaluateCandidate({
            candidate: 'ঢাকার বাইরে ডেলিভারি চার্জ ১২০ টাকা।', evidence, language: 'bn',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        expect(evaluateCandidate({
            candidate: 'ঢাকার বাইরে ডেলিভারি চার্জ ৬০ টাকা।', evidence, language: 'bn',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'ডেলিভারি চার্জ ৬০ টাকা।', evidence, language: 'bn',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test('a foreign currency symbol cannot borrow a matching BDT amount', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Classic Blue Denim Jacket price?',
            candidates: [catalogProduct()],
        });

        expect(evaluateCandidate({
            candidate: 'The jacket costs ৳3,200.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        for (const candidate of [
            'The jacket costs $3,200.',
            'The jacket costs ₹3,200.',
            'The jacket costs EUR 3,200.',
            'The jacket costs Rs. 3,200.',
            'The jacket costs ¥3,200.',
            'The jacket costs ₩3,200.',
            'The jacket costs JPY 3,200.',
            'The jacket costs GBP 3,200.',
            'The jacket costs CNY 3,200.',
            'The jacket costs AED 3,200.',
            'The jacket costs SAR 3,200.',
            'The jacket costs BRL 3,200.',
            'The jacket costs MXN 3,200.',
            'The jacket costs EGP 3,200.',
            'The jacket costs KZT 3,200.',
            'The jacket costs brl 3,200.',
            'The jacket costs mxn 3,200.',
        ]) {
            expect(evaluateCandidate({ candidate, evidence, language: 'en' }).decision)
                .toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        }
        expect(grounding.unsupportedPriceClaims('The jacket costs BRL 3,200.', evidence))
            .toContain('3200');
    });

    test('payment methods must match the live configured payment methods', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence,
            '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD) ONLY.\nOnline / card / advance payment is NOT set up for this shop.');

        for (const candidate of [
            'We accept bKash and Nagad.',
            'Please pay by card before delivery.',
            'We accept PayPal.',
            'We accept bank transfer.',
            'We accept UPI.',
            'We accept Google Pay.',
            'We accept Visa.',
            'We accept cryptocurrency.',
        ]) {
            const result = evaluateCandidate({ candidate, evidence, language: 'en' });
            expect(result.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
            expect(result.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
        }

        expect(evaluateCandidate({
            candidate: 'We accept Cash on Delivery.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);

        const mfsEnabled = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(mfsEnabled,
            '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD), and advance payment via bKash to the personal number 01711111111.');
        expect(evaluateCandidate({
            candidate: 'We accept bKash.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        expect(evaluateCandidate({
            candidate: 'Pay via bKash to 01711111111.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        expect(evaluateCandidate({
            candidate: 'Pay via bKash to ০১৭১১১১১১১১.', evidence: mfsEnabled, language: 'bn',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        expect(evaluateCandidate({
            candidate: 'Pay via bKash to +8801799999999.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        const contextWithDeliveryContact = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(contextWithDeliveryContact,
            '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD), and advance payment via bKash to the personal number 01711111111.\nFor advance payment, send the amount to 01711111111 (bKash).\nDelivery support phone: 01722222222.');
        expect(evaluateCandidate({
            candidate: 'Pay via bKash to 01722222222.', evidence: contextWithDeliveryContact, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'Pay via bKash to ০১৭৯৯৯৯৯৯৯৯.', evidence: contextWithDeliveryContact, language: 'bn',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept returns by UPI.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept orders via Payoneer.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept orders with Payoneer.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept orders with Payoneer at 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept bookings with Payoneer.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept bookings with Payoneer at 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept returns with Payoneer.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept refunds with Payoneer at 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept refunds to Payoneer at 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept Payoneer for refunds at 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept refunds to 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept returns to phone number 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept orders via MoneyGram to 01799999999.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept returns to bKash at 01799999999.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept orders via Payoneer and bKash.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept Payoneer and bKash.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(evaluateCandidate({
            candidate: 'We accept bKash and Nagad.', evidence: mfsEnabled, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test('a booking confirmation condition is not mistaken for a payment method', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        expect(evaluateCandidate({
            candidate: 'We accept bookings with a confirmation.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('free delivery on an order is not mistaken for a payment method', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        expect(evaluateCandidate({
            candidate: 'We accept orders with free delivery.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });

    test('payment method detection does not mistake product titles for payment claims', () => {
        const onlineProduct = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Online Exclusive Jacket available?',
            candidates: [catalogProduct({ name: 'Online Exclusive Jacket' })],
        });
        grounding.withPolicyText(onlineProduct,
            '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD) ONLY.');

        const googlePayProduct = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Google Pay Jacket available?',
            candidates: [catalogProduct({ name: 'Google Pay Jacket' })],
        });
        grounding.withPolicyText(googlePayProduct,
            '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD) ONLY.');

        for (const [candidate, evidence] of [
            ['Online Exclusive Jacket is available.', onlineProduct],
            ['Google Pay Jacket is available.', googlePayProduct],
        ]) {
            expect(evaluateCandidate({ candidate, evidence, language: 'en' }).decision)
                .toBe(grounding.GroundingDecision.SEND);
        }
    });

    test('return and exchange acceptance is not mistaken for payment methods', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence,
            'We accept returns within 7 days. We accept exchanges within 7 days. We can take returns within seven days. We accept returns by the end of the week. We accept returns by request. We accept returns by appointment. We accept returns with receipt, tags, and original packaging.');

        for (const candidate of [
            'We accept returns within 7 days.',
            'We accept exchanges within 7 days.',
            'We can take returns within seven days.',
            'We accept returns by the end of the week.',
            'We accept returns by request.',
            'We accept returns by appointment.',
            'We accept returns via our courier.',
            'We accept returns through local courier.',
            'We accept returns with receipt.',
            'We accept returns with tags.',
            'We accept returns with original packaging.',
            'We accept returns to seller.',
            'We accept returns to seller at 01722222222.',
        ]) {
            expect(evaluateCandidate({ candidate, evidence, language: 'en' }).decision)
                .toBe(grounding.GroundingDecision.SEND);
        }
    });

    test('delivery timelines require matching locations and affirmative policy evidence', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence,
            'Inside Dhaka delivery takes 2 days. Outside Dhaka delivery takes 3 days. Delivery tomorrow is unavailable.');

        expect(evaluateCandidate({
            candidate: 'Outside Dhaka delivery takes 3 days.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
        for (const candidate of [
            'Inside Dhaka delivery takes 3 days.',
            'We will deliver tomorrow.',
        ]) {
            expect(evaluateCandidate({ candidate, evidence, language: 'en' }).decision)
                .toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        }
    });

    test.each([
        ['ঢাকার বাইরে ৩ দিনে ডেলিভারি হবে।', 'unsupported_delivery_timeline'],
        ['ঢাকার বাইরে ডেলিভারি হবে।', 'unsupported_delivery_commitment'],
    ])('an inside-only policy rejects unsupported Bengali delivery coverage: %s', (candidate, violation) => {
        const insideOnly = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(insideOnly, 'ঢাকার ভিতরে ডেলিভারি ২ দিনে হবে।');

        expect(grounding.unsupportedDomainClaims(candidate, insideOnly)).toContain(violation);
        expect(evaluateCandidate({ candidate, evidence: insideOnly, language: 'bn' }).decision)
            .toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test('Bengali delivery digits match the policy timeline for their location', () => {
        const differentTimeline = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(differentTimeline,
            'ঢাকার ভিতরে ডেলিভারি ২ দিনে হবে। ঢাকার বাইরে ডেলিভারি ৫ দিনে হবে।');
        expect(evaluateCandidate({
            candidate: 'ঢাকার বাইরে ৩ দিনে ডেলিভারি হবে।', evidence: differentTimeline, language: 'bn',
        }).decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test.each([
        'ঢাকায় ডেলিভারি ২ দিনে হবে।',
        'ঢাকায় ডেলিভারি ৫ দিনে হবে।',
    ])('a city-only Bengali delivery timeline is ambiguous across inside/outside policies: %s', (candidate) => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence,
            'ঢাকার ভিতরে ডেলিভারি ২ দিনে হবে। ঢাকার বাইরে ডেলিভারি ৫ দিনে হবে।');

        expect(evaluateCandidate({ candidate, evidence, language: 'bn' }).decision)
            .toBe(grounding.GroundingDecision.SAFE_FALLBACK);
    });

    test('configured delivery coverage supports that claim but does not support a promised date', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence, 'Delivery: available nationwide across Bangladesh.');

        const supported = evaluateCandidate({
            candidate: 'We can deliver nationwide across Bangladesh.',
            evidence,
            language: 'en',
        });
        const unsupported = evaluateCandidate({
            candidate: 'We will deliver tomorrow.',
            evidence,
            language: 'en',
        });

        expect(supported.decision).toBe(grounding.GroundingDecision.SEND);
        expect(unsupported.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(unsupported.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    });

    test('negative location-specific delivery policy cannot authorize positive coverage', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence, 'Delivery is not available inside Dhaka.');

        const result = evaluateCandidate({
            candidate: 'Delivery is available inside Dhaka.',
            evidence,
            language: 'en',
        });

        expect(result.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(result.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    });

    test('positive delivery coverage cannot authorize an unsupported negative claim', () => {
        const evidence = grounding.emptyEvidence(SHOP);
        grounding.withPolicyText(evidence, 'Delivery: available nationwide across Bangladesh.');

        const result = evaluateCandidate({
            candidate: 'Delivery is not available nationwide across Bangladesh.',
            evidence,
            language: 'en',
        });

        expect(result.decision).toBe(grounding.GroundingDecision.SAFE_FALLBACK);
        expect(result.reasonCode).toBe(grounding.ReasonCode.UNSUPPORTED_DOMAIN_CLAIM);
    });

    test('a product named Rocket is not mistaken for a Rocket payment claim', () => {
        const evidence = grounding.resolveProductEvidence({
            shopId: SHOP,
            message: 'Rocket jacket available?',
            candidates: [catalogProduct({ name: 'Rocket Jacket', price: 3200 })],
        });
        grounding.withPolicyText(evidence,
            '--- SHOP PAYMENT & DELIVERY (authoritative) ---\nAccepted payment: Cash on Delivery (COD) ONLY.');

        expect(evaluateCandidate({
            candidate: 'The Rocket Jacket is available.', evidence, language: 'en',
        }).decision).toBe(grounding.GroundingDecision.SEND);
    });
});
