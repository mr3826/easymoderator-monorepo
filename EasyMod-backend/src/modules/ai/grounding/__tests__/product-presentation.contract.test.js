'use strict';

process.env.NODE_ENV = 'test';
process.env.API_URL = 'https://api.easymod.tech';
process.env.PUBLIC_ASSET_URL = 'https://api.easymod.tech';

const grounding = require('src/modules/ai/grounding');
const {
    buildProductPresentation,
    renderMessengerProductPresentation,
    validateProductPresentation,
} = require('src/modules/ai/product-experience/product-presentation');

const SHOP = 'shop-a';

const product = (overrides = {}) => ({
    id: 'p-1',
    shop_id: SHOP,
    name: 'Classic Blue Denim Jacket',
    name_bn: 'ক্লাসিক নীল ডেনিম জ্যাকেট',
    category: 'jacket',
    price: 3200,
    is_active: true,
    in_stock: true,
    track_quantity: false,
    quantity: 0,
    variants: [{ id: 'v-xl', option_name: 'Size', option_value: 'XL', price: null, quantity: 2, is_active: true }],
    images: [],
    image_url: 'https://api.easymod.tech/uploads/product-images/shop-a/jacket.jpg',
    tags: [],
    ai_material: 'cotton',
    ...overrides,
});

const evidenceFor = (products, message = 'Classic Blue Denim Jacket price?') =>
    grounding.resolveProductEvidence({ shopId: SHOP, message, candidates: products });

describe('channel-neutral product presentation', () => {
    test('only verified catalog evidence becomes a presentation payload', () => {
        const presentation = buildProductPresentation(evidenceFor([product()]));

        expect(presentation.schemaVersion).toBe('1');
        expect(presentation.shopId).toBe(SHOP);
        expect(presentation.status).toBe('READY');
        expect(presentation.products[0].price).toEqual({ state: 'KNOWN', amount: 3200, currency: 'BDT' });
        expect(presentation.products[0].variants).toEqual([expect.objectContaining({
            id: 'v-xl', value: 'XL', availability: { state: 'KNOWN', value: 'IN_STOCK' },
        })]);
        expect(presentation.products[0].image).toEqual({
            state: 'AVAILABLE', url: 'https://api.easymod.tech/uploads/product-images/shop-a/jacket.jpg',
        });
        expect(presentation.products[0].detailLink).toEqual({ state: 'UNKNOWN', url: null });
        expect(validateProductPresentation(presentation)).toEqual([]);
    });

    test('a sold-out parent product keeps every variant unavailable', () => {
        const message = 'Classic Blue Denim Jacket XL size price?';
        const presentation = buildProductPresentation(evidenceFor([product({ in_stock: false })], message), { message });
        const payload = renderMessengerProductPresentation(presentation, 'en');

        expect(presentation.products[0].attributes.stock).toEqual({ state: 'KNOWN', value: 'OUT_OF_STOCK' });
        expect(presentation.products[0].variants[0].availability).toEqual({ state: 'KNOWN', value: 'OUT_OF_STOCK' });
        expect(payload.text).toContain('This option is currently out of stock.');
        expect(payload.text).not.toContain('This option is in stock.');
    });

    test('multi-product Messenger rendering asks the customer to choose and sends no arbitrary image', () => {
        const presentation = buildProductPresentation(evidenceFor([
            product(),
            product({ id: 'p-2', name: 'Premium Black Denim Jacket', price: 2400, image_url: 'https://api.easymod.tech/uploads/product-images/shop-a/panjabi.jpg', variants: [] }),
        ], 'denim jacket price?'));

        const payload = renderMessengerProductPresentation(presentation, 'en');

        expect(presentation.selection).toBe('MULTIPLE');
        expect(payload.text).toContain('Classic Blue Denim Jacket');
        expect(payload.text).toContain('Premium Black Denim Jacket');
        expect(payload.text).toContain('Which one');
        expect(payload.attachments).toEqual([]);
    });

    test('Messenger rendering attaches only the image already authorized for one product', () => {
        const evidence = evidenceFor([product()], 'Classic Blue Denim Jacket photo please');
        const presentation = buildProductPresentation(evidence);
        const payload = renderMessengerProductPresentation(presentation, 'mixed');

        expect(payload.attachments).toEqual([{
            type: 'image',
            url: 'https://api.easymod.tech/uploads/product-images/shop-a/jacket.jpg',
            productId: 'p-1',
        }]);
    });

    test('explicit XL price uses the verified XL price and never the parent price', () => {
        const message = 'Classic Blue Denim Jacket XL size price?';
        const evidence = evidenceFor([product({
            variants: [
                { id: 'v-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                { id: 'v-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
            ],
        })], message);
        const presentation = buildProductPresentation(evidence, { message, language: 'english' });
        const payload = renderMessengerProductPresentation(presentation, 'english');

        expect(presentation.products[0].price).toEqual({ state: 'KNOWN', amount: 3300, currency: 'BDT' });
        expect(presentation.products[0].selectedVariant).toEqual({ id: 'v-xl', option: 'Size', value: 'XL' });
        expect(payload.text).toContain('XL — ৳3,300');
        expect(payload.text).not.toContain('৳3,200');
    });

    test('a live matching prior selection remains selected on a follow-up', () => {
        const evidence = grounding.resolveContextualAttributeEvidence({
            shopId: SHOP,
            message: 'price?',
            contextProducts: [product({
                variants: [
                    { id: 'v-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                    { id: 'v-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
                ],
            })],
        });
        const presentation = buildProductPresentation(evidence, {
            message: 'price?',
            language: 'english',
            selectedVariants: { 'p-1': { id: 'v-xl', option: 'Size', value: 'XL' } },
        });
        const payload = renderMessengerProductPresentation(presentation, 'english');

        expect(presentation.products[0].selectedVariant).toEqual({ id: 'v-xl', option: 'Size', value: 'XL' });
        expect(payload.text).toContain('XL — ৳3,300');
        expect(payload.text).toContain('This option is in stock.');
        expect(payload.text).not.toContain('৳3,200');
    });

    test.each(['size L price?', 'XL or M price?', 'সাইজ L দাম?', 'সাইজ ৪২ দাম?'])(
        'an unknown or conflicting current variant request clears a prior selection: %s',
        message => {
            const evidence = grounding.resolveContextualAttributeEvidence({
                shopId: SHOP,
                message,
                contextProducts: [product({
                    variants: [
                        { id: 'v-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                        { id: 'v-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
                    ],
                })],
            });
            const presentation = buildProductPresentation(evidence, {
                message,
                language: 'english',
                selectedVariants: { 'p-1': { id: 'v-xl', option: 'Size', value: 'XL' } },
            });
            const payload = renderMessengerProductPresentation(presentation, 'english');

            expect(presentation.products[0].selectedVariant).toBeNull();
            expect(presentation.products[0].price).toEqual({ state: 'UNKNOWN', amount: null, currency: 'BDT' });
            expect(payload.text).not.toContain('XL — ৳3,300');
        },
    );

    test('generic presentation lists distinct variant prices and suppresses an ambiguous parent price', () => {
        const evidence = evidenceFor([product({
            variants: [
                { id: 'v-m', option_name: 'Size', option_value: 'M', price: 3200, quantity: 2, is_active: true },
                { id: 'v-xl', option_name: 'Size', option_value: 'XL', price: 3300, quantity: 1, is_active: true },
            ],
        })], 'Classic Blue Denim Jacket');
        const presentation = buildProductPresentation(evidence);
        const payload = renderMessengerProductPresentation(presentation, 'en');

        expect(presentation.products[0].price).toEqual({ state: 'UNKNOWN', amount: null, currency: 'BDT' });
        expect(payload.text).toContain('M (৳3,200)');
        expect(payload.text).toContain('XL (৳3,300)');
    });

    test('Bangla display uses the merchant Bangla title and normalized language labels', () => {
        const presentation = buildProductPresentation(evidenceFor([product()]), { language: 'bangla' });
        const payload = renderMessengerProductPresentation(presentation, 'bangla');

        expect(presentation.language).toBe('bn');
        expect(payload.text).toContain('ক্লাসিক নীল ডেনিম জ্যাকেট');
        expect(payload.text).toContain('উপলভ্য অপশন:');
    });

    test('presentation validator rejects malformed fact states and media ownership', () => {
        const presentation = buildProductPresentation(evidenceFor([product()]));
        presentation.products[0].variants[0].availability.state = 'MAYBE';
        presentation.products[0].image.url = 'https://api.easymod.tech/uploads/product-images/shop-b/other.jpg';

        expect(validateProductPresentation(presentation)).toEqual(expect.arrayContaining([
            'variant_availability_state_invalid',
            'product_image_invalid',
        ]));
    });

    test('unverified AI attributes and missing prices are not promoted to facts', () => {
        const presentation = buildProductPresentation(evidenceFor([product({ price: null })]));

        expect(presentation.products[0].price).toEqual({ state: 'UNKNOWN', amount: null, currency: 'BDT' });
        expect(presentation.products[0].attributes.material).toEqual({ state: 'UNCERTAIN', value: 'cotton' });
    });
});
